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
  -- Whether `v_plan` actually holds a row.
  --
  -- `v_plan` is a RECORD, and reading a field of one that was never assigned
  -- raises "record v_plan is not assigned yet" — it does not return NULL, the
  -- way an unassigned scalar would. So every test of "did we resolve a plan"
  -- has to ask a scalar, not the record.
  v_plan_id      TEXT;
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
      --
      -- Resolved in two steps, id first into a scalar and only then the row.
      -- Reading a field of a RECORD that no SELECT INTO ever assigned raises
      -- "record v_plan is not assigned yet", so the row is fetched only once an
      -- id is known to exist. That keeps this independent of what a zero-row
      -- SELECT INTO leaves behind, which is the subtlety the bug turned on.
      SELECT id INTO v_plan_id FROM public.subscription_plans WHERE id = v_sub.plan_id;
      IF v_plan_id IS NOT NULL THEN
        SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_plan_id;
      END IF;
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
  -- The test is `v_plan_id`, not `v_plan.id`. That is the whole bug this guards:
  -- `v_plan` is a RECORD, so testing it directly raised
  -- "record v_plan is not assigned yet" on precisely the accounts this branch
  -- exists to serve — no subscription row, or one that has lapsed, expired or
  -- been canceled. Since `enforce_inventory_entitlements()` reaches here through
  -- `can_add_product()`, that error came out of adding an inventory item, which
  -- is what made it look like an inventory bug rather than an entitlement one.
  --
  -- Pointed at tier 'free', NOT 'free_trial'. The trial plans now carry the tier
  -- above them (Premium/Pro features), so falling back to one would hand a lapsed
  -- account the very features it just lost.
  IF v_plan_id IS NULL THEN
    SELECT id INTO v_plan_id FROM public.subscription_plans
    WHERE audience = COALESCE(v_account_type, 'household') AND tier = 'free'
    LIMIT 1;

    IF v_plan_id IS NOT NULL THEN
      SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_plan_id;
    END IF;
  END IF;

  -- Nothing to fall back to means the plan catalogue is missing a `free` row for
  -- this audience — a broken install, not a customer state. Say so plainly: the
  -- alternative is dereferencing v_plan again below and raising the same
  -- unhelpful "not assigned yet" from three different lines.
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'entitlements_unavailable: no free plan for audience %', v_account_type
      USING ERRCODE = 'no_data_found',
            HINT = 'The subscription_plans catalogue is missing its tier=''free'' row for this audience.';
  END IF;

  SELECT COALESCE(jsonb_object_agg(
           fe.feature_key,
           jsonb_build_object('enabled', fe.enabled, 'limit', fe.limit_value)
         ), '{}'::jsonb)
  INTO v_features
  FROM public.feature_entitlements fe
  WHERE fe.plan_id = v_plan_id;

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

    -- --- Trial metadata ----------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Verify. Read the output; nothing here should error.
--
-- If the bug were still present, the second query would fail with
-- `record "v_plan" is not assigned yet` instead of returning a plan_id — so a
-- table of rows below IS the proof, not just a nicety.
-- ---------------------------------------------------------------------------

-- 1. How many accounts are in the state that used to throw?
SELECT
  'accounts with no live subscription' AS check_name,
  COUNT(*)::TEXT                       AS detail
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions s
  WHERE s.user_id = p.id
    AND s.status IN ('trialing', 'active', 'past_due')
    AND s.current_period_end > NOW()
);

-- 2. Resolve entitlements for exactly those accounts. Every row must come back
--    with a plan_id from the free floor rather than raising.
SELECT
  p.id                                     AS user_id,
  p.account_type,
  public.get_user_entitlements(p.id) ->> 'plan_id'      AS resolved_plan_id,
  public.get_user_entitlements(p.id) ->> 'plan_name'    AS resolved_plan_name,
  public.get_user_entitlements(p.id) ->> 'status'       AS subscription_status,
  (public.get_user_entitlements(p.id) ->> 'max_products')::INTEGER AS max_products
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions s
  WHERE s.user_id = p.id
    AND s.status IN ('trialing', 'active', 'past_due')
    AND s.current_period_end > NOW()
)
ORDER BY p.created_at DESC
LIMIT 10;
