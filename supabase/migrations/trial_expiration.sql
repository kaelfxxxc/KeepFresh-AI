-- ============================================================================
-- 1. FREE TIER vs FREE TRIAL
-- ============================================================================
-- Until this section, one plan per audience did two unrelated jobs.
-- `household_trial` / `establishment_trial` was BOTH the 7/3-day free trial AND
-- the permanent floor an account falls back to once its plan lapses. That is the
-- entire reason the establishment trial could not grant Pro: the trial's own
-- feature rows were also the floor's, so switching them on would have handed Pro
-- to every lapsed establishment account, permanently, for free.
--
-- This section gives each role its own plan:
--
--   *_free    the permanent floor. Seeded with exactly what the trial granted
--             before this file ran, so a lapsed account loses nothing.
--   *_trial   a genuine, time-limited taste of the tier above it —
--             Household → Premium features, Establishment → Pro features.
--
-- It must run before section 3, which re-points the fallback at tier 'free'.

-- The CHECKs were written inline in CREATE TABLE, so Postgres auto-named them
-- `<table>_<column>_check`. Dropping and re-adding is the only way to widen one,
-- and the DROP ... IF EXISTS in front is what keeps this file re-runnable.
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('free', 'free_trial', 'premium', 'pro'));

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_billing_period_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_billing_period_check
  CHECK (billing_period IN ('free', 'trial', 'monthly', 'yearly'));

-- The permanent free floor, one per audience. Capacity and features are exactly
-- what the trial granted before this migration, so an account that lapses today
-- keeps every product, storage area and feature it already had.
--
-- `billing_period = 'free'` is what keeps these off the plan list and out of
-- `isPurchasable()` — they are the floor, not something to buy. `duration_days`
-- is meaningless here (nothing ever expires a free plan); it only satisfies the
-- NOT NULL.
INSERT INTO public.subscription_plans
  (id, audience, tier, billing_period, name, description, price_php, duration_days, max_products, max_ai_scans, sort_order)
VALUES
  ('household_free',     'household',     'free', 'free', 'Household Free',
   'The essentials — manual entry, expiration alerts and your pantry, free for as long as you need them.',
   0, 30, 30, 10, 90),
  ('establishment_free', 'establishment', 'free', 'free', 'Establishment Free',
   'The essentials — manual entry, expiration alerts and your inventory, free for as long as you need them.',
   0, 30, 50, 10, 91)
ON CONFLICT (id) DO UPDATE SET
  audience       = EXCLUDED.audience,
  tier           = EXCLUDED.tier,
  billing_period = EXCLUDED.billing_period,
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  price_php      = EXCLUDED.price_php,
  duration_days  = EXCLUDED.duration_days,
  max_products   = EXCLUDED.max_products,
  max_ai_scans   = EXCLUDED.max_ai_scans,
  sort_order     = EXCLUDED.sort_order,
  updated_at     = NOW();

-- The floor inherits the matrix the trial used to carry, and the trial inherits
-- the tier above it. Same shape as the matrix in subscriptions_entitlements.sql:
-- joined on (audience, tier), so every plan of a tier picks these up.
WITH feature_matrix (audience, tier, feature_key, enabled, limit_value) AS (
  VALUES
    -- Household — Free. What the household trial granted before today.
    ('household', 'free', 'manual_entry',          TRUE,  NULL::INTEGER),
    ('household', 'free', 'expiration_alerts',     TRUE,  NULL),
    ('household', 'free', 'ai_recipes',            TRUE,  5),
    ('household', 'free', 'smart_grocery_list',    TRUE,  NULL),
    ('household', 'free', 'waste_report',          FALSE, NULL),
    ('household', 'free', 'advanced_waste_report', FALSE, NULL),
    ('household', 'free', 'price_tracking',        FALSE, NULL),
    ('household', 'free', 'multiple_storage',      TRUE,  1),
    ('household', 'free', 'advanced_inventory',    FALSE, NULL),
    ('household', 'free', 'staff_management',      FALSE, NULL),
    ('household', 'free', 'bulk_inventory',        FALSE, NULL),

    -- Establishment — Free. What the establishment trial granted before today.
    ('establishment', 'free', 'manual_entry',          TRUE,  NULL),
    ('establishment', 'free', 'expiration_alerts',     TRUE,  NULL),
    ('establishment', 'free', 'ai_recipes',            FALSE, NULL),
    ('establishment', 'free', 'smart_grocery_list',    FALSE, NULL),
    ('establishment', 'free', 'waste_report',          FALSE, NULL),
    ('establishment', 'free', 'advanced_waste_report', FALSE, NULL),
    ('establishment', 'free', 'price_tracking',        FALSE, NULL),
    ('establishment', 'free', 'multiple_storage',      TRUE,  1),
    ('establishment', 'free', 'advanced_inventory',    FALSE, NULL),
    ('establishment', 'free', 'staff_management',      FALSE, NULL),
    ('establishment', 'free', 'bulk_inventory',        FALSE, NULL),

    -- Household — Free Trial. Mirrors Household Premium: the trial is a 7-day
    -- look at Premium, not a longer version of the free plan.
    ('household', 'free_trial', 'manual_entry',          TRUE,  NULL),
    ('household', 'free_trial', 'expiration_alerts',     TRUE,  NULL),
    ('household', 'free_trial', 'ai_recipes',            TRUE,  NULL),
    ('household', 'free_trial', 'smart_grocery_list',    TRUE,  NULL),
    ('household', 'free_trial', 'waste_report',          TRUE,  NULL),
    ('household', 'free_trial', 'advanced_waste_report', FALSE, NULL),
    ('household', 'free_trial', 'price_tracking',        TRUE,  NULL),
    ('household', 'free_trial', 'multiple_storage',      TRUE,  5),
    ('household', 'free_trial', 'advanced_inventory',    FALSE, NULL),
    ('household', 'free_trial', 'staff_management',      FALSE, NULL),
    ('household', 'free_trial', 'bulk_inventory',        FALSE, NULL),

    -- Establishment — Free Trial. Mirrors Establishment Pro. This is the fix:
    -- the 3-day trial now unlocks Pro, staff management and bulk inventory
    -- included.
    ('establishment', 'free_trial', 'manual_entry',          TRUE,  NULL),
    ('establishment', 'free_trial', 'expiration_alerts',     TRUE,  NULL),
    ('establishment', 'free_trial', 'ai_recipes',            TRUE,  NULL),
    ('establishment', 'free_trial', 'smart_grocery_list',    TRUE,  NULL),
    ('establishment', 'free_trial', 'waste_report',          TRUE,  NULL),
    ('establishment', 'free_trial', 'advanced_waste_report', TRUE,  NULL),
    ('establishment', 'free_trial', 'price_tracking',        TRUE,  NULL),
    ('establishment', 'free_trial', 'multiple_storage',      TRUE,  NULL),
    ('establishment', 'free_trial', 'advanced_inventory',    TRUE,  NULL),
    ('establishment', 'free_trial', 'staff_management',      TRUE,  NULL),
    ('establishment', 'free_trial', 'bulk_inventory',        TRUE,  NULL)
)
INSERT INTO public.feature_entitlements (plan_id, feature_key, enabled, limit_value)
SELECT p.id, m.feature_key, m.enabled, m.limit_value
FROM feature_matrix m
JOIN public.subscription_plans p ON p.audience = m.audience AND p.tier = m.tier
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  enabled     = EXCLUDED.enabled,
  limit_value = EXCLUDED.limit_value;

-- Capacity follows the features. A trial that unlocks Pro but caps at 50
-- products is a stranger combination than the one it replaces.
--
-- Note this raises what a trial can hold without lowering the floor, so an
-- establishment that fills 1,500 products in three days keeps all of them when
-- the trial lapses — it simply cannot add a 51st until it subscribes. Nothing is
-- ever deleted; that is the same contract a lapsed Premium account already has.
UPDATE public.subscription_plans AS sp
   SET max_products = t.max_products,
       max_ai_scans = t.max_ai_scans,
       updated_at   = NOW()
  FROM (VALUES ('household_trial',      100,   50),
               ('establishment_trial', 1500, 300)) AS t(id, max_products, max_ai_scans)
 WHERE sp.id = t.id
   AND (sp.max_products <> t.max_products OR sp.max_ai_scans <> t.max_ai_scans);

-- ============================================================================
-- 2. TRIAL LENGTHS
-- ============================================================================

UPDATE public.subscription_plans
   SET duration_days = 3,
       description   = 'Try every Pro feature for 3 days.',
       updated_at    = NOW()
 WHERE id = 'establishment_trial'
   AND (duration_days <> 3 OR description IS DISTINCT FROM 'Try every Pro feature for 3 days.');

UPDATE public.subscription_plans
   SET description = 'Try every Premium feature for 7 days.',
       updated_at  = NOW()
 WHERE id = 'household_trial'
   AND duration_days = 7
   AND description IS DISTINCT FROM 'Try every Premium feature for 7 days.';

-- ============================================================================
-- 3. get_user_entitlements()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_entitlements(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_account_type TEXT := 'household';
  v_sub          RECORD;
  v_plan         RECORD;
  v_features     JSONB;
  v_products     INTEGER := 0;
  v_scans        INTEGER := 0;
  v_status       TEXT;
  v_is_active    BOOLEAN := FALSE;
  v_was_trial    BOOLEAN := FALSE;
  v_was_trial_name TEXT;
  v_days_left    INTEGER := 0;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF auth.uid() IS NOT NULL AND v_uid <> auth.uid() THEN
    RAISE EXCEPTION 'access_denied: user_id does not match the session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(p.account_type, 'household') INTO v_account_type
  FROM public.profiles p WHERE p.id = v_uid;

  -- The newest subscription, live ones first.
  --
  -- Lapsed rows are read on purpose. `current_period_end` — not the status
  -- column — is what decides whether a plan is running, so reading a lapsed row
  -- grants nothing; it only lets the answer carry a reason.
  SELECT s.* INTO v_sub
  FROM public.user_subscriptions s
  WHERE s.user_id = v_uid
  ORDER BY (s.status IN ('trialing', 'active', 'past_due')) DESC,
           s.current_period_end DESC
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    v_status := 'none';
  ELSE
    -- Timezone-safe by construction: both sides are TIMESTAMPTZ, so this is an
    -- instant compared against an instant whatever the device or server offset.
    v_is_active := v_sub.current_period_end > NOW()
                   AND v_sub.status IN ('trialing', 'active');

    -- Was the plan this row names a trial, and what was it called? Read from the
    -- ROW's plan, not the resolved one, so a lapsed trial is still recognisable as
    -- a trial — and still nameable, now that the fallback below is a different
    -- plan whose name would otherwise answer for it.
    SELECT (sp.billing_period = 'trial'), sp.name
      INTO v_was_trial, v_was_trial_name
    FROM public.subscription_plans sp
    WHERE sp.id = v_sub.plan_id;
    v_was_trial := COALESCE(v_was_trial, FALSE);

    IF v_is_active THEN
      -- Features come from the plan being paid for — only while it is running.
      SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id;
      v_status := v_sub.status;
    ELSIF v_sub.status = 'canceled' THEN
      v_status := 'canceled';
    ELSE
      v_status := 'expired';
    END IF;

    -- Whole days left, floored at 0 so a lapsed plan reads "0", never "-3".
    -- CEIL matches the client's daysRemaining() helper, so a trial ending in
    -- 20 hours reads "1 day left" in both places.
    v_days_left := GREATEST(
      CEIL(EXTRACT(EPOCH FROM (v_sub.current_period_end - NOW())) / 86400.0)::INTEGER,
      0
    );
  END IF;

  -- The floor. An audience's `free` plan defines what still applies once a paid
  -- plan lapses, and is the plan for someone who never had one at all. Reached
  -- whenever nothing above filled v_plan — i.e. whenever the account has no live
  -- subscription, which is exactly the "back to a free account" state.
  --
  -- Pointed at tier 'free', NOT 'free_trial'. The trial plans now carry the tier
  -- above them (Premium/Pro features), so falling back to one would hand a lapsed
  -- account the very features it just lost.
  IF v_plan.id IS NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE audience = COALESCE(v_account_type, 'household') AND tier = 'free'
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_object_agg(
           fe.feature_key,
           jsonb_build_object('enabled', fe.enabled, 'limit', fe.limit_value)
         ), '{}'::jsonb)
  INTO v_features
  FROM public.feature_entitlements fe
  WHERE fe.plan_id = v_plan.id;

  -- `products_used` counts LIVE products (available + expired). Consumed and
  -- wasted rows are history, not stock, and must not eat capacity.
  SELECT COUNT(*) INTO v_products
  FROM public.inventory_items i
  WHERE i.user_id = v_uid
    AND i.status NOT IN ('consumed', 'wasted');

  SELECT COALESCE(u.ai_scans_used, 0) INTO v_scans
  FROM public.subscription_usage u
  WHERE u.user_id = v_uid
    AND u.period_start = date_trunc('month', CURRENT_DATE)::date;

  v_scans := COALESCE(v_scans, 0);

  RETURN jsonb_build_object(
    'user_id',           v_uid,
    'account_type',      v_account_type,
    'plan_id',           v_plan.id,
    'plan_name',         v_plan.name,
    'audience',          v_plan.audience,
    'tier',              v_plan.tier,
    'billing_period',    v_plan.billing_period,
    'price_php',         v_plan.price_php,
    'status',            v_status,
    'is_active',         v_is_active,
    'started_at',        v_sub.started_at,
    'current_period_end',v_sub.current_period_end,
    'cancel_at_period_end', COALESCE(v_sub.cancel_at_period_end, FALSE),
    'auto_renew',        COALESCE(v_sub.auto_renew, FALSE),
    'provider',          COALESCE(v_sub.provider, 'none'),
    'is_verified_paid',  (v_sub.provider_verified_at IS NOT NULL AND v_sub.provider <> 'none'),
    'max_products',      v_plan.max_products,
    'products_used',     v_products,
    'max_ai_scans',      v_plan.max_ai_scans,
    'ai_scans_used',     v_scans,
    'usage_period_start', date_trunc('month', CURRENT_DATE)::date,
    'features',          v_features,

    -- --- Trial metadata (added by this migration) -------------------------
    -- `subscription_plan_id` is the ROW's plan, which stops being the same as
    -- `plan_id` the moment a plan lapses: plan_id becomes the free-tier floor
    -- while this keeps naming what the user actually had. It is what lets the
    -- app tell "your free trial ended" apart from "your Premium plan ended" —
    -- a distinction `tier` cannot make, since both report 'free' after the
    -- fallback.
    'subscription_plan_id', v_sub.plan_id,
    -- The same plan's display name, so the "your trial has ended" notice can
    -- name the trial itself rather than the free plan it fell back to.
    'subscription_plan_name', v_was_trial_name,
    'trial_started_at', CASE WHEN v_was_trial THEN v_sub.started_at         ELSE NULL END,
    'trial_ends_at',    CASE WHEN v_was_trial THEN v_sub.current_period_end ELSE NULL END,
    'is_trialing',      (v_is_active AND v_status = 'trialing'),
    'days_remaining',   v_days_left
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_entitlements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_entitlements(UUID) TO authenticated;

-- ============================================================================
-- 4. guard_subscription_update()
-- ============================================================================
-- Blocks a modified client from writing its own entitlements. The one change
-- from the original: a clock-driven transition to expired/canceled is allowed,
-- because `sync_my_subscription` (section 5) is a SECURITY DEFINER function
-- running as the caller and would otherwise be rejected by its own trigger.
--
-- Safe because `current_period_end` is still protected below, so a client cannot
-- forge the `OLD.current_period_end <= NOW()` half of the condition — and expiry
-- is derived from the clock on every read regardless of the stored status.

CREATE OR REPLACE FUNCTION public.guard_subscription_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() IS NULL means a service-role call or a scheduled job. Trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.current_period_end <= NOW()
              AND NEW.status IN ('expired', 'canceled')) THEN
    RAISE EXCEPTION
      'subscription_plan_change_requires_server_verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.user_id                 IS DISTINCT FROM OLD.user_id
     OR NEW.plan_id              IS DISTINCT FROM OLD.plan_id
     OR NEW.started_at           IS DISTINCT FROM OLD.started_at
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end   IS DISTINCT FROM OLD.current_period_end
     OR NEW.provider             IS DISTINCT FROM OLD.provider
     OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id
     OR NEW.provider_verified_at IS DISTINCT FROM OLD.provider_verified_at THEN
    RAISE EXCEPTION
      'subscription_plan_change_requires_server_verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subscription_update ON public.user_subscriptions;
CREATE TRIGGER trg_guard_subscription_update
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_update();


-- ============================================================================
-- 5. expire_stale_subscriptions() + sync_my_subscription()
-- ============================================================================
-- Re-stated here so this file stands alone even if the earlier migration's tail
-- never applied.

CREATE OR REPLACE FUNCTION public.expire_stale_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.user_subscriptions
     SET status     = CASE WHEN cancel_at_period_end THEN 'canceled' ELSE 'expired' END,
         updated_at = NOW()
   WHERE status IN ('trialing', 'active', 'past_due')
     AND current_period_end <= NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Deliberately NOT granted to authenticated: one user must never be able to
-- expire everyone's plan.
REVOKE ALL ON FUNCTION public.expire_stale_subscriptions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_my_subscription()
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.user_subscriptions
     SET status     = CASE WHEN cancel_at_period_end THEN 'canceled' ELSE 'expired' END,
         updated_at = NOW()
   WHERE user_id = v_uid
     AND status IN ('trialing', 'active', 'past_due')
     AND current_period_end <= NOW();

  -- A new statement, so it sees the update above.
  RETURN public.get_user_entitlements(v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_my_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_subscription() TO authenticated;

-- ============================================================================
-- 6. grant_default_entitlements() + backfill
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_default_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id  TEXT;
  v_days     INTEGER;
  v_default  INTEGER;
  v_sub_id   UUID;
BEGIN
  v_plan_id := CASE WHEN NEW.account_type = 'establishment'
                    THEN 'establishment_trial'
                    ELSE 'household_trial' END;

  v_default := CASE WHEN NEW.account_type = 'establishment' THEN 3 ELSE 7 END;

  SELECT duration_days INTO v_days
  FROM public.subscription_plans WHERE id = v_plan_id;

  v_days := COALESCE(v_days, v_default);

  INSERT INTO public.user_subscriptions
    (user_id, plan_id, status, started_at, current_period_start, current_period_end, provider)
  VALUES
    (NEW.id, v_plan_id, 'trialing', NOW(), NOW(), NOW() + (v_days || ' days')::INTERVAL, 'none')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_sub_id;

  INSERT INTO public.subscription_usage
    (user_id, subscription_id, period_start, period_end, ai_scans_used)
  VALUES
    (NEW.id, v_sub_id,
     date_trunc('month', CURRENT_DATE)::date,
     (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
     0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  INSERT INTO public.storage_areas (user_id, name, kind, is_default)
  VALUES
    (NEW.id, 'Refrigerator', 'refrigerator', TRUE),
    (NEW.id, 'Freezer',      'freezer',      FALSE),
    (NEW.id, 'Pantry',       'pantry',       FALSE)
  ON CONFLICT (user_id, name) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_default_entitlements();

INSERT INTO public.user_subscriptions
  (user_id, plan_id, status, started_at, current_period_start, current_period_end, provider)
SELECT
  p.id,
  t.plan_id,
  'trialing', NOW(), NOW(),
  NOW() + (COALESCE(sp.duration_days, t.fallback_days) || ' days')::INTERVAL,
  'none'
FROM public.profiles p
CROSS JOIN LATERAL (
  SELECT CASE WHEN p.account_type = 'establishment'
              THEN 'establishment_trial' ELSE 'household_trial' END AS plan_id,
         CASE WHEN p.account_type = 'establishment' THEN 3 ELSE 7 END AS fallback_days
) t
LEFT JOIN public.subscription_plans sp ON sp.id = t.plan_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions s WHERE s.user_id = p.id
);

INSERT INTO public.subscription_usage (user_id, subscription_id, period_start, period_end)
SELECT s.user_id, s.id,
       date_trunc('month', CURRENT_DATE)::date,
       (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
FROM public.user_subscriptions s
WHERE s.status IN ('trialing', 'active', 'past_due')
ON CONFLICT (user_id, period_start) DO NOTHING;

INSERT INTO public.storage_areas (user_id, name, kind, is_default)
SELECT p.id, a.name, a.kind, a.is_default
FROM public.profiles p
CROSS JOIN (VALUES
  ('Refrigerator', 'refrigerator', TRUE),
  ('Freezer',      'freezer',      FALSE),
  ('Pantry',       'pantry',       FALSE)
) AS a(name, kind, is_default)
ON CONFLICT (user_id, name) DO NOTHING;


-- ============================================================================
-- 7. Schedule the housekeeping job
-- ============================================================================
-- Optional and guarded: a project without pg_cron still gets everything above.

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be created here (%). Enable it under Database -> Extensions, then re-run this section.', SQLERRM;
  END;

  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'Skipping the expiry schedule: pg_cron is not installed. Everything else in this file applied.';
    RETURN;
  END IF;

  -- Unschedule first so re-running this file replaces the job instead of
  -- failing on the duplicate name.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'keepfresh-subscription-expiry') THEN
    PERFORM cron.unschedule('keepfresh-subscription-expiry');
  END IF;

  -- 03:17 rather than on the hour: every cron job on the platform defaulting to
  -- :00 is a self-inflicted load spike.
  PERFORM cron.schedule(
    'keepfresh-subscription-expiry',
    '17 3 * * *',
    'SELECT public.expire_stale_subscriptions();'
  );

  RAISE NOTICE 'Scheduled keepfresh-subscription-expiry to run daily at 03:17.';
END;
$$;

-- What to expect in the output:
--   trial_plans   household_trial = 7 days, establishment_trial = 3 days,
--                 both at the capacity of the tier they unlock.
--   free_plans    household_free = 30 products, establishment_free = 50 — the
--                 floor a lapsed account lands on.
SELECT
  (SELECT string_agg(id || ' = ' || duration_days || 'd / ' || max_products || ' products',
                     ', ' ORDER BY id)
     FROM public.subscription_plans WHERE tier = 'free_trial')            AS trial_plans,
  (SELECT string_agg(id || ' = ' || max_products || ' products / ' || max_ai_scans || ' scans',
                     ', ' ORDER BY id)
     FROM public.subscription_plans WHERE tier = 'free')                  AS free_plans,
  (SELECT COUNT(*) FROM public.user_subscriptions
    WHERE status IN ('trialing', 'active', 'past_due')
      AND current_period_end <= NOW())                                    AS rows_awaiting_expiry,
  'KeepFresh AI trial expiration ready'                                   AS status;
