-- SMS Gate queue, notification consent, delivery history, and OTP challenges.
-- Apply after philippines_phone_number.sql and low_stock_push_alerts.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_low_stock BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_expiration BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_expiration_days INTEGER[] NOT NULL DEFAULT ARRAY[3,1,0];

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+639[0-9]{9}$'),
  message_type TEXT NOT NULL CHECK (message_type IN ('otp','low_stock','expiration','subscription')),
  message_text TEXT NOT NULL,
  dedupe_key TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own SMS history" ON public.sms_messages;
CREATE POLICY "Users read own SMS history" ON public.sms_messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.sms_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
CREATE INDEX IF NOT EXISTS sms_messages_queue_idx ON public.sms_messages(next_attempt_at, created_at)
  WHERE status IN ('pending','failed') AND attempts < 5;
CREATE INDEX IF NOT EXISTS sms_messages_user_history_idx ON public.sms_messages(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_provider_id_idx ON public.sms_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sms_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+639[0-9]{9}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_phone','account_security')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sms_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_otp_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sms_otp_challenges TO service_role;
CREATE INDEX IF NOT EXISTS sms_otp_phone_created_idx ON public.sms_otp_challenges(phone_number, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sms_low_stock_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  threshold NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent'))
);
ALTER TABLE public.sms_low_stock_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_low_stock_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sms_low_stock_events TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS sms_low_stock_open_item_idx ON public.sms_low_stock_events(inventory_item_id)
  WHERE status IN ('pending','processing');

CREATE OR REPLACE FUNCTION public.enqueue_sms_low_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'available'
     AND COALESCE(NEW.quantity, 0) <= COALESCE(NEW.low_stock_threshold, 2)
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'available'
          OR COALESCE(OLD.quantity,0) > COALESCE(OLD.low_stock_threshold,2)
          OR COALESCE(OLD.low_stock_threshold,2) < COALESCE(NEW.low_stock_threshold,2)) THEN
    INSERT INTO public.sms_low_stock_events(user_id,inventory_item_id,quantity,threshold)
    VALUES(NEW.user_id,NEW.id,COALESCE(NEW.quantity,0),COALESCE(NEW.low_stock_threshold,2))
    ON CONFLICT (inventory_item_id) WHERE status IN ('pending','processing') DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enqueue_sms_low_stock ON public.inventory_items;
CREATE TRIGGER trg_enqueue_sms_low_stock AFTER INSERT OR UPDATE OF quantity,low_stock_threshold,status
  ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.enqueue_sms_low_stock();
REVOKE ALL ON FUNCTION public.enqueue_sms_low_stock() FROM PUBLIC,anon,authenticated;

SELECT 'SMS Gateway schema ready' AS status;
