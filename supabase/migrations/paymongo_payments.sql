ALTER TABLE public.user_subscriptions
  DROP CONSTRAINT IF EXISTS user_subscriptions_provider_check;

ALTER TABLE public.user_subscriptions
  ADD CONSTRAINT user_subscriptions_provider_check
  CHECK (provider IN ('none', 'google_play', 'app_store', 'stripe', 'manual', 'paymongo'));

CREATE TABLE IF NOT EXISTS public.paymongo_checkout_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id              TEXT NOT NULL REFERENCES public.subscription_plans(id),

  amount_centavos      INTEGER NOT NULL CHECK (amount_centavos > 0),
  currency             TEXT NOT NULL DEFAULT 'PHP',

  -- Ours, set at creation, NOT NULL, and echoed back by PayMongo in every
  -- payment notification. It is the identifier the webhook matches on first,
  -- because unlike the session id it is guaranteed to be on our row.
  reference_number     TEXT NOT NULL UNIQUE,

  checkout_session_id  TEXT UNIQUE,

  status               TEXT NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'paid', 'expired', 'failed')),

  -- Filled in when the session is settled, from the webhook or from a
  -- server-side re-check against PayMongo.
  payment_id           TEXT,
  payment_method_used  TEXT CHECK (payment_method_used IN ('gcash', 'paymaya', 'qrph')),
  paid_at              TIMESTAMPTZ,

  -- The subscription this attempt produced. NULL until it is paid, and set from
  -- the same transaction that claims the row.
  subscription_id      UUID REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,

  -- The PayMongo document, kept whole. When a payment is disputed months later
  -- this is the only record of exactly what the gateway said.
  raw_payload          JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  existing_constraint RECORD;
BEGIN
  FOR existing_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.paymongo_checkout_sessions'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%payment_method_used%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.paymongo_checkout_sessions DROP CONSTRAINT %I',
      existing_constraint.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.paymongo_checkout_sessions
  ADD CONSTRAINT paymongo_checkout_sessions_payment_method_used_check
  CHECK (payment_method_used IN ('gcash', 'paymaya', 'qrph'));

-- ---------------------------------------------------------------------------
-- 3. Indexes and access.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_paymongo_sessions_user
  ON public.paymongo_checkout_sessions (user_id, created_at DESC);

-- Partial, because the only question ever asked of this column is "which
-- attempts are still open" — an unconverted checkout is the rare case, so the
-- index stays small.
CREATE INDEX IF NOT EXISTS idx_paymongo_sessions_open
  ON public.paymongo_checkout_sessions (status, created_at DESC)
  WHERE status = 'created';

ALTER TABLE public.paymongo_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- SELECT-own-rows, and nothing else. A customer may look at their own payment
-- history; no client may write any of it.
DROP POLICY IF EXISTS "Users can view own checkout sessions" ON public.paymongo_checkout_sessions;
CREATE POLICY "Users can view own checkout sessions" ON public.paymongo_checkout_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);



SELECT
  'provider CHECK allows paymongo' AS check_name,
  pg_get_constraintdef(oid)        AS detail
FROM pg_constraint
WHERE conrelid = 'public.user_subscriptions'::regclass
  AND conname  = 'user_subscriptions_provider_check'

UNION ALL

SELECT
  'payment_method_used allows qrph',
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.paymongo_checkout_sessions'::regclass
  AND conname  = 'paymongo_checkout_sessions_payment_method_used_check'

UNION ALL

SELECT
  'paymongo_checkout_sessions exists',
  COUNT(*)::TEXT || ' rows'
FROM public.paymongo_checkout_sessions;
