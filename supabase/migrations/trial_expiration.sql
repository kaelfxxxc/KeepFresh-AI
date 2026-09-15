-- ============================================================================
-- KeepFresh AI — automatic trial expiration
-- ============================================================================
-- Paste this whole file into the Supabase SQL editor and run it. It is
-- idempotent: running it twice changes nothing the second time.
--
-- Household accounts get a 7-day free trial of Premium; Food Establishment
-- accounts get a 3-day trial of Pro. When a trial ends the account falls back
-- to the free tier automatically — with nothing deleted, and with the
-- entitlement decided by the database rather than by the app.
--
-- Most of that machinery already exists (see
-- supabase/migrations/subscriptions_entitlements.sql). This file completes it:
--
--   1. Food Establishment trials become 3 days.
--   2. get_user_entitlements() survives the housekeeping job that flips lapsed
--      rows — and stops handing a lapsed user their old plan's features.
--   3. guard_subscription_update() lets a row catch up with the clock.
--   4. sync_my_subscription() brings the CALLER's own row up to date, which is
--      what "handled automatically on app open" means in practice. The
--      whole-table job stays un-callable by clients.
--   5. New accounts read their trial length from subscription_plans instead of
--      a hardcoded 7 days, and the backfill stops re-trialling lapsed users.
--   6. The housekeeping job runs daily. Subscription expiry needs no edge
--      function and no API key — it is pure SQL.
-- ============================================================================


-- ============================================================================
-- 1. FOOD ESTABLISHMENT TRIAL: 3 DAYS
-- ============================================================================
-- The trial length lives in subscription_plans.duration_days, which is where
-- grant_default_entitlements() reads it from. Changing it here changes every
-- account created from now on.
--
-- Trials that are ALREADY RUNNING are deliberately left alone — there is no
-- UPDATE against user_subscriptions in this section. Cutting a live trial short
-- would revoke access a user was already promised, and each row carries its own
-- current_period_end precisely so it is not at the mercy of a later edit.

UPDATE public.subscription_plans
   SET duration_days = 3,
       description   = 'Try the inventory basics for 3 days.',
       updated_at    = NOW()
 WHERE id = 'establishment_trial'
   AND (duration_days <> 3 OR description IS DISTINCT FROM 'Try the inventory basics for 3 days.');

UPDATE public.subscription_plans
   SET description = 'Try every core feature for 7 days.',
       updated_at  = NOW()
 WHERE id = 'household_trial'
   AND duration_days = 7
   AND description IS DISTINCT FROM 'Try every core feature for 7 days.';


-- ============================================================================
-- 2. get_user_entitlements() — the single source of truth
-- ============================================================================
-- Three changes from the original, and no key removed, so existing callers
-- keep working:
--
--   a. The subscription lookup no longer filters to live statuses. A lapsed row
--      is still read, so the app can say "expired" or "cancelled" instead of
--      collapsing to a blank "no plan" in the window between a plan ending and
--      the daily job flipping the row.
--
--   b. The plan's features are taken ONLY while the period is actually running.
--      This is the important one. The original was safe by accident: its WHERE
--      clause hid lapsed rows, so v_plan was never populated for them. Widening
--      that clause without moving the plan lookup inside `IF v_is_active` would
--      hand a lapsed Premium account Premium features, because the free-tier
--      fallback is guarded by `IF v_plan.id IS NULL`.
--
--   c. Trial metadata is returned, so the client reads one authoritative
--      "days remaining" rather than recomputing it from a timestamp and its own
--      clock.

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

    -- Was the plan this row names a trial? Read from the ROW's plan, not from
    -- the resolved one, so a lapsed trial is still recognisable as a trial.
    SELECT (sp.billing_period = 'trial') INTO v_was_trial
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

  -- The floor. An audience's free_trial plan defines what still applies once a
  -- paid plan lapses, and is the plan for someone who never had one at all.
  -- Reached whenever nothing above filled v_plan — i.e. whenever the account has
  -- no live subscription, which is exactly the "back to a free account" state.
  IF v_plan.id IS NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE audience = COALESCE(v_account_type, 'household') AND tier = 'free_trial'
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
    -- a distinction `tier` cannot make, since both report 'free_trial' after
    -- the fallback.
    'subscription_plan_id', v_sub.plan_id,
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
-- 3. guard_subscription_update() — let a row catch up with the clock
-- ============================================================================
-- The original rejected EVERY client-side change to `status`, which is right
-- for a plan change and wrong for this: it meant a signed-in user could never
-- let their own lapsed row say it had lapsed.
--
-- A period that has already ended is expired whether or not the column says so
-- — get_user_entitlements() derives that from current_period_end, not from
-- status. So permitting this transition grants nothing. A client cannot forge
-- the condition either: current_period_end is protected by the second check
-- below, so it can only be in the past if it genuinely is.
--
-- Everything that actually confers entitlement is still server-only. A client
-- still cannot buy itself a plan, move a period, or mark itself verified.

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
-- 4. expire_stale_subscriptions() + sync_my_subscription()
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

-- ---------------------------------------------------------------------------
-- sync_my_subscription — the same rule, scoped to the caller.
--
-- This is what "handle an expired trial automatically whenever the user opens
-- the app, logs in, or checks subscription status" means in practice. The app
-- calls it on launch and on returning to the foreground; it applies the expiry
-- rule to this one user and hands back the freshly computed entitlements.
--
-- Scoping it to auth.uid() is what makes it safe to expose. The whole-table
-- version above stays un-callable by clients, so no user can expire another's
-- plan.
--
-- It reads the entitlements from the same function the database enforces with,
-- so the app can never be shown a plan the triggers would disagree with.
--
-- The UPDATE is a no-op in the ordinary case — the WHERE only matches a row
-- whose period has already ended. It touches no billing term, and only the
-- clock-driven status transition, which the guard trigger permits.
-- ---------------------------------------------------------------------------
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
-- 5. NEW USER BOOTSTRAP — read the trial length from the plan
-- ============================================================================
-- The original hardcoded 7 days in two places, which is how the establishment
-- trial would have quietly stayed at 7 no matter what section 1 said.

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

  -- The trial length is a property of the plan, not of this function. The
  -- fallback only applies if the plan row is missing outright, and it matches
  -- the seeded values so a half-migrated database still grants something sane
  -- rather than defaulting everyone to 7 days.
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

-- ---------------------------------------------------------------------------
-- Backfill for profiles that predate the subscription tables.
--
-- The WHERE is tightened from the original. It used to match "has no LIVE
-- subscription", which on a second run would have handed a brand-new trial to
-- every account whose plan had lapsed — silently un-expiring them. Matching
-- "has no subscription row at all" makes this genuinely once-per-account.
-- ---------------------------------------------------------------------------
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
-- 6. DAILY HOUSEKEEPING JOB
-- ============================================================================
-- Expiry needs no edge function, no HTTP call and no API key: the rule is a
-- single UPDATE, so pg_cron can run it directly on the database.
--
-- The job is a tidiness measure, not the enforcement. get_user_entitlements()
-- derives expiry from NOW() on every read, so a user is correctly locked out
-- the second their trial ends whether or not this job has run. What the job
-- adds is a row that agrees with reality — which matters for support, for
-- reporting, and for the "your trial ended" notice.
--
-- Guarded so a project without pg_cron still applies everything above.
-- Enable it under Database -> Extensions in the Supabase dashboard.

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be created here (%). Enable it under Database -> Extensions, then re-run section 6.', SQLERRM;
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


-- ============================================================================
-- 7. Done
-- ============================================================================

-- Deliberately does not count cron.job: naming that relation in a plain SELECT
-- would be resolved at parse time even when pg_cron is absent, failing the whole
-- file and rolling back everything above it. Section 6's NOTICE already reports
-- whether the job was scheduled.
SELECT
  (SELECT string_agg(id || ' = ' || duration_days || ' days', ', ' ORDER BY id)
     FROM public.subscription_plans WHERE tier = 'free_trial')            AS trial_lengths,
  (SELECT COUNT(*) FROM public.user_subscriptions
    WHERE status IN ('trialing', 'active', 'past_due')
      AND current_period_end <= NOW())                                    AS rows_awaiting_expiry,
  'KeepFresh AI trial expiration ready'                                   AS status;
