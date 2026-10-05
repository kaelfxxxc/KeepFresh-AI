ALTER TABLE public.inventory_order_items
  ALTER COLUMN inventory_item_id DROP NOT NULL;

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
  v_name TEXT;
  v_unit TEXT;
  v_price NUMERIC(12,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(trim(p_destination), '') = '' OR p_items IS NULL
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;

  -- Lock and validate inventory-backed lines, and validate scanned snapshots.
  FOR v_line IN SELECT value AS entry FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_line.entry ->> 'quantity')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'invalid_order_quantity';
    END IF;
    IF NULLIF(v_line.entry ->> 'item_id', '') IS NOT NULL THEN
      SELECT * INTO v_item FROM public.inventory_items
       WHERE id = (v_line.entry ->> 'item_id')::UUID
         AND user_id = v_user AND status = 'available'
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'inventory_item_not_available'; END IF;
      IF COALESCE(v_item.quantity, 0) < (v_line.entry ->> 'quantity')::NUMERIC THEN
        RAISE EXCEPTION 'insufficient_inventory: %', v_item.product_name;
      END IF;
      v_subtotal := v_subtotal + COALESCE(v_item.price, 0) * (v_line.entry ->> 'quantity')::NUMERIC;
    ELSE
      v_name := NULLIF(trim(v_line.entry ->> 'product_name'), '');
      v_unit := COALESCE(NULLIF(trim(v_line.entry ->> 'unit'), ''), 'pcs');
      v_price := COALESCE((v_line.entry ->> 'price')::NUMERIC, 0);
      IF v_name IS NULL OR v_price < 0 THEN RAISE EXCEPTION 'invalid_scanned_product'; END IF;
      v_subtotal := v_subtotal + v_price * (v_line.entry ->> 'quantity')::NUMERIC;
    END IF;
  END LOOP;

  INSERT INTO public.inventory_orders (user_id, destination, status, subtotal, total)
  VALUES (v_user, trim(p_destination), 'placed', v_subtotal, v_subtotal)
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT value AS entry FROM jsonb_array_elements(p_items)
  LOOP
    IF NULLIF(v_line.entry ->> 'item_id', '') IS NOT NULL THEN
      SELECT * INTO v_item FROM public.inventory_items
       WHERE id = (v_line.entry ->> 'item_id')::UUID AND user_id = v_user FOR UPDATE;
      INSERT INTO public.inventory_order_items
        (order_id, user_id, inventory_item_id, product_name, quantity, unit, unit_price, line_total)
      VALUES
        (v_order_id, v_user, v_item.id, v_item.product_name,
         (v_line.entry ->> 'quantity')::NUMERIC, COALESCE(v_item.unit, 'pcs'),
         COALESCE(v_item.price, 0), COALESCE(v_item.price, 0) * (v_line.entry ->> 'quantity')::NUMERIC);
      UPDATE public.inventory_items
         SET quantity = COALESCE(quantity, 0) - (v_line.entry ->> 'quantity')::NUMERIC,
             updated_at = NOW()
       WHERE id = v_item.id;
    ELSE
      v_name := trim(v_line.entry ->> 'product_name');
      v_unit := COALESCE(NULLIF(trim(v_line.entry ->> 'unit'), ''), 'pcs');
      v_price := COALESCE((v_line.entry ->> 'price')::NUMERIC, 0);
      INSERT INTO public.inventory_order_items
        (order_id, user_id, inventory_item_id, product_name, quantity, unit, unit_price, line_total)
      VALUES
        (v_order_id, v_user, NULL, v_name, (v_line.entry ->> 'quantity')::NUMERIC,
         v_unit, v_price, v_price * (v_line.entry ->> 'quantity')::NUMERIC);
    END IF;
  END LOOP;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_inventory_order(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_inventory_order(TEXT, JSONB) TO authenticated;
