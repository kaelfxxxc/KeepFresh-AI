-- Server-driven low stock push alerts for KeepFresh AI's inventory_items model.
-- Apply after subscriptions_entitlements.sql, notification_center.sql, and
-- inventory_orders.sql.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC NOT NULL DEFAULT 2
    CHECK (low_stock_threshold > 0);

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS low_stock_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Keep notification history if its inventory item is later removed.
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_inventory_item_id_fkey;
ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_inventory_item_id_fkey
  FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own push tokens" ON public.push_tokens;
CREATE POLICY "Users manage own push tokens" ON public.push_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.low_stock_push_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  threshold NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent')),
  attempts INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.low_stock_push_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.low_stock_push_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.low_stock_push_events TO service_role;
CREATE INDEX IF NOT EXISTS idx_low_stock_push_pending
  ON public.low_stock_push_events (created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.enqueue_low_stock_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Alert only on a transition into low stock. Re-stocking above the threshold
  -- rearms the next crossing; repeated edits while low do not create spam.
  IF NEW.status = 'available'
     AND COALESCE(NEW.quantity, 0) <= COALESCE(NEW.low_stock_threshold, 2)
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'available'
          OR COALESCE(OLD.quantity, 0) > COALESCE(OLD.low_stock_threshold, 2)
          OR COALESCE(OLD.low_stock_threshold, 2) < COALESCE(NEW.low_stock_threshold, 2)) THEN
    INSERT INTO public.low_stock_push_events
      (user_id, inventory_item_id, quantity, threshold)
    VALUES (NEW.user_id, NEW.id, COALESCE(NEW.quantity, 0), COALESCE(NEW.low_stock_threshold, 2));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_low_stock_push ON public.inventory_items;
CREATE TRIGGER trg_enqueue_low_stock_push
  AFTER INSERT OR UPDATE OF quantity, low_stock_threshold, status ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_low_stock_push();

REVOKE ALL ON FUNCTION public.enqueue_low_stock_push() FROM PUBLIC, anon, authenticated;

-- Existing inventory may already be below its threshold when this feature is
-- installed, so it will not cross the trigger after deployment. Queue those
-- current low items once; the unique partial index prevents duplicate pending
-- or processing events for the same item.
CREATE UNIQUE INDEX IF NOT EXISTS idx_low_stock_push_one_open_event_per_item
  ON public.low_stock_push_events (inventory_item_id)
  WHERE status IN ('pending', 'processing');

INSERT INTO public.low_stock_push_events (user_id, inventory_item_id, quantity, threshold)
SELECT i.user_id, i.id, COALESCE(i.quantity, 0), COALESCE(i.low_stock_threshold, 2)
  FROM public.inventory_items AS i
 WHERE i.status = 'available'
   AND COALESCE(i.quantity, 0) <= COALESCE(i.low_stock_threshold, 2)
ON CONFLICT (inventory_item_id) WHERE status IN ('pending', 'processing') DO NOTHING;

-- When a user enables low-stock push after stock is already low, queue the
-- existing items too. Turning the setting on again cannot duplicate open work.
CREATE OR REPLACE FUNCTION public.enqueue_existing_low_stock_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.low_stock_enabled AND NOT COALESCE(OLD.low_stock_enabled, FALSE) THEN
    INSERT INTO public.low_stock_push_events (user_id, inventory_item_id, quantity, threshold)
    SELECT i.user_id, i.id, COALESCE(i.quantity, 0), COALESCE(i.low_stock_threshold, 2)
      FROM public.inventory_items AS i
     WHERE i.user_id = NEW.user_id
       AND i.status = 'available'
       AND COALESCE(i.quantity, 0) <= COALESCE(i.low_stock_threshold, 2)
    ON CONFLICT (inventory_item_id) WHERE status IN ('pending', 'processing') DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_existing_low_stock_push ON public.notification_preferences;
CREATE TRIGGER trg_enqueue_existing_low_stock_push
  AFTER UPDATE OF low_stock_enabled ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_existing_low_stock_push();

REVOKE ALL ON FUNCTION public.enqueue_existing_low_stock_push() FROM PUBLIC, anon, authenticated;

-- The app's Place Order flow previously recorded order rows without changing
-- stock. Keep order creation and deductions in one transaction so the trigger
-- above observes the committed sale and competing checkouts cannot oversell.
CREATE OR REPLACE FUNCTION public.place_inventory_order(
  p_destination TEXT,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_order_id UUID;
  v_line RECORD;
  v_item public.inventory_items%ROWTYPE;
  v_subtotal NUMERIC(12,2) := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(trim(p_destination), '') = '' OR p_items IS NULL
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;

  FOR v_line IN
    SELECT (entry ->> 'item_id')::UUID AS item_id,
           SUM((entry ->> 'quantity')::NUMERIC) AS quantity
      FROM jsonb_array_elements(p_items) entry
     GROUP BY (entry ->> 'item_id')::UUID
     ORDER BY (entry ->> 'item_id')::UUID
  LOOP
    IF v_line.quantity <= 0 THEN RAISE EXCEPTION 'invalid_order_quantity'; END IF;
    SELECT * INTO v_item FROM public.inventory_items
     WHERE id = v_line.item_id AND user_id = v_user AND status = 'available'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory_item_not_available'; END IF;
    IF COALESCE(v_item.quantity, 0) < v_line.quantity THEN
      RAISE EXCEPTION 'insufficient_inventory: %', v_item.product_name;
    END IF;
    v_subtotal := v_subtotal + COALESCE(v_item.price, 0) * v_line.quantity;
  END LOOP;

  INSERT INTO public.inventory_orders (user_id, destination, status, subtotal, total)
  VALUES (v_user, trim(p_destination), 'placed', v_subtotal, v_subtotal)
  RETURNING id INTO v_order_id;

  FOR v_line IN
    SELECT (entry ->> 'item_id')::UUID AS item_id,
           SUM((entry ->> 'quantity')::NUMERIC) AS quantity
      FROM jsonb_array_elements(p_items) entry
     GROUP BY (entry ->> 'item_id')::UUID
     ORDER BY (entry ->> 'item_id')::UUID
  LOOP
    SELECT * INTO v_item FROM public.inventory_items
     WHERE id = v_line.item_id AND user_id = v_user FOR UPDATE;

    INSERT INTO public.inventory_order_items
      (order_id, user_id, inventory_item_id, product_name, quantity, unit,
       unit_price, line_total)
    VALUES
      (v_order_id, v_user, v_item.id, v_item.product_name, v_line.quantity,
       COALESCE(v_item.unit, 'pcs'), COALESCE(v_item.price, 0),
       COALESCE(v_item.price, 0) * v_line.quantity);

    UPDATE public.inventory_items
       SET quantity = COALESCE(quantity, 0) - v_line.quantity,
           updated_at = NOW()
     WHERE id = v_item.id;
  END LOOP;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.place_inventory_order(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_inventory_order(TEXT, JSONB) TO authenticated;

-- A worker claims one event using a conditional UPDATE. Concurrent function
-- runs cannot both send the same event. Failed sends return it to pending.
CREATE OR REPLACE FUNCTION public.claim_low_stock_push_event(p_id BIGINT)
RETURNS SETOF public.low_stock_push_events
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.low_stock_push_events
     SET status = 'processing', attempts = attempts + 1
   WHERE id = p_id AND status = 'pending'
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_low_stock_push_event(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_low_stock_push_event(BIGINT) TO service_role;

-- pg_cron / pg_net invoke the low-stock Edge Function once a minute. Fill in
-- the project URL and anon key in this schedule after deploying the function.
SELECT 'Low stock push alert schema ready' AS status;
