-- ============================================================================
-- KeepFresh AI — Staff management, bulk inventory RPCs & entitlement fixes
-- ============================================================================
-- Follow-up to 20260914120000_subscriptions_entitlements.sql.
--
-- Three things:
--
--   1. SECURITY DEFINER routines that CANNOT be expressed with row-level
--      security alone:
--        * create_organization      — inserts the org and its owner row together
--        * add_org_member_by_email  — needs to read another user's profile,
--                                     which RLS deliberately forbids
--        * bulk_*                   — one authorised batch instead of N separate
--                                     round-trips that can half-apply
--
--   2. Corrections to the feature matrix. Re-reading the specification:
--      Household Premium does NOT include multiple storage areas (only Pro
--      does), and Food Establishment Premium does. The first migration granted
--      Premium a 5-area allowance; fixed here.
--
--   3. The signup bootstrap created three storage areas, which contradicts any
--      plan limited to one. New accounts now get a single default area, and the
--      surplus defaults are removed from existing accounts — but only when they
--      are unused, so no real inventory organisation is ever destroyed.
--
-- Every function below re-checks permissions explicitly. SECURITY DEFINER runs
-- as the table owner, which BYPASSES row-level security — so the ownership
-- predicates inside these bodies are the security boundary, not a nicety.
-- ============================================================================

-- ============================================================================
-- 1. ENTITLEMENT MATRIX CORRECTIONS
-- ============================================================================

UPDATE public.feature_entitlements fe
   SET limit_value = 1
  FROM public.subscription_plans p
 WHERE fe.plan_id = p.id
   AND fe.feature_key = 'multiple_storage'
   AND p.audience = 'household'
   AND p.tier = 'premium';

UPDATE public.feature_entitlements fe
   SET limit_value = 5
  FROM public.subscription_plans p
 WHERE fe.plan_id = p.id
   AND fe.feature_key = 'multiple_storage'
   AND p.audience = 'establishment'
   AND p.tier = 'premium';

-- ============================================================================
-- 2. ORGANISATIONS
-- ============================================================================

-- Creating an organisation and its owner membership must be atomic: RLS cannot
-- let the creator insert their own membership row, because `can_manage_org`
-- only returns true once that very row exists.
CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT DEFAULT NULL)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_staff_management(v_uid) THEN
    RAISE EXCEPTION 'staff_management_not_in_plan'
      USING ERRCODE = 'check_violation',
            HINT = 'Staff accounts are included in Food Establishment Pro.';
  END IF;

  INSERT INTO public.organizations (name, owner_id, account_type)
  SELECT COALESCE(NULLIF(TRIM(p_name), ''), 'My Business'),
         v_uid,
         COALESCE(p.account_type, 'establishment')
  FROM public.profiles p
  WHERE p.id = v_uid
  RETURNING * INTO v_org;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found: no profile row for %', v_uid
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (v_org.id, v_uid, 'owner', 'active', v_uid)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = 'owner', status = 'active', updated_at = NOW();

  RETURN v_org;
END;
$$;

-- Add a staff member by email. The lookup has to happen here because the
-- `profiles` RLS policy only exposes a user's own row — a client-side
-- "SELECT id FROM profiles WHERE email = ..." returns nothing by design.
CREATE OR REPLACE FUNCTION public.add_org_member_by_email(
  p_org   UUID,
  p_email TEXT,
  p_role  TEXT DEFAULT 'staff'
)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_target UUID;
  v_row    public.organization_members;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_staff_management(v_uid) THEN
    RAISE EXCEPTION 'staff_management_not_in_plan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.can_manage_org(p_org, v_uid) THEN
    RAISE EXCEPTION 'access_denied: only an owner or manager can add staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Ownership is transferred at creation, never granted through an invite.
  IF p_role NOT IN ('manager', 'staff') THEN
    RAISE EXCEPTION 'invalid_role: role must be manager or staff'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.id INTO v_target
  FROM public.profiles p
  WHERE LOWER(p.email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'member_not_found: no KeepFresh AI account uses that email'
      USING ERRCODE = 'no_data_found',
            HINT = 'Ask them to create an account first, then add them here.';
  END IF;

  IF v_target = v_uid THEN
    RAISE EXCEPTION 'invalid_member: you are already the owner of this organisation'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.organization_members
    (organization_id, user_id, role, status, invited_email, invited_by)
  VALUES
    (p_org, v_target, p_role, 'active', LOWER(TRIM(p_email)), v_uid)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role         = EXCLUDED.role,
        status       = 'active',
        invited_email = EXCLUDED.invited_email,
        invited_by   = EXCLUDED.invited_by,
        updated_at   = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ============================================================================
-- 3. BULK INVENTORY
-- ============================================================================
-- All three routines check the `bulk_inventory` entitlement and refuse to touch
-- a single row the caller does not own. Capacity is validated for the WHOLE
-- batch before anything is written, so a bulk add either lands completely or
-- not at all — never half-applied.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_add_inventory(p_items JSONB)
RETURNS SETOF public.inventory_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_item    JSONB;
  v_row     public.inventory_items;
  v_batch   INTEGER;
  v_live    INTEGER;
  v_max     INTEGER;
  v_area    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_bulk_inventory(v_uid) THEN
    RAISE EXCEPTION 'bulk_inventory_not_in_plan'
      USING ERRCODE = 'check_violation',
            HINT = 'Bulk inventory is included in Food Establishment Pro.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: p_items must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_batch := jsonb_array_length(p_items);
  IF v_batch = 0 THEN
    RETURN;
  END IF;

  IF v_batch > 500 THEN
    RAISE EXCEPTION 'batch_too_large: at most 500 rows per bulk operation'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Capacity for the entire batch, checked once, before writing anything.
  SELECT COUNT(*) INTO v_live
  FROM public.inventory_items i
  WHERE i.user_id = v_uid AND i.status NOT IN ('consumed', 'wasted');

  v_max := (public.get_user_entitlements(v_uid) ->> 'max_products')::INTEGER;

  IF v_live + v_batch > v_max THEN
    RAISE EXCEPTION 'inventory_limit_reached'
      USING ERRCODE = 'check_violation',
            HINT = format('You have %s of %s products used and are adding %s. Upgrade for more capacity.',
                          v_live, v_max, v_batch);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(TRIM(v_item ->> 'product_name'), '') = '' THEN
      RAISE EXCEPTION 'invalid_payload: every row needs a product_name'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- A storage area must be one of the caller's own.
    v_area := NULLIF(v_item ->> 'storage_area_id', '')::UUID;
    IF v_area IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.storage_areas sa WHERE sa.id = v_area AND sa.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'access_denied: storage area % is not yours', v_area
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO public.inventory_items (
      user_id, product_name, brand, category, quantity, unit,
      purchase_date, expiration_date, price, barcode, notes, image_url,
      storage_area_id, organization_id, added_by, expiration_alert_days, status
    )
    VALUES (
      v_uid,
      TRIM(v_item ->> 'product_name'),
      NULLIF(TRIM(COALESCE(v_item ->> 'brand', '')), ''),
      NULLIF(TRIM(COALESCE(v_item ->> 'category', '')), ''),
      GREATEST(COALESCE((v_item ->> 'quantity')::NUMERIC, 1), 0),
      COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'unit', '')), ''), 'pcs'),
      NULLIF(v_item ->> 'purchase_date', '')::DATE,
      NULLIF(v_item ->> 'expiration_date', '')::DATE,
      NULLIF(v_item ->> 'price', '')::NUMERIC,
      NULLIF(TRIM(COALESCE(v_item ->> 'barcode', '')), ''),
      NULLIF(TRIM(COALESCE(v_item ->> 'notes', '')), ''),
      NULLIF(TRIM(COALESCE(v_item ->> 'image_url', '')), ''),
      v_area,
      NULLIF(v_item ->> 'organization_id', '')::UUID,
      v_uid,
      COALESCE((v_item ->> 'expiration_alert_days')::INTEGER, 3),
      'available'
    )
    RETURNING * INTO v_row;

    -- One summary row so the history shows this as a single batch action; the
    -- per-row trigger deliberately skips nothing, so both views stay accurate.
    INSERT INTO public.inventory_transactions
      (user_id, actor_id, inventory_item_id, product_name, action, quantity_after, unit, metadata)
    VALUES
      (v_uid, v_uid, v_row.id, v_row.product_name, 'bulk_add',
       v_row.quantity, v_row.unit, jsonb_build_object('batch_size', v_batch));

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_update_inventory(
  p_item_ids UUID[],
  p_updates  JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_accessible INTEGER;
  v_requested  INTEGER;
  v_affected   INTEGER;
  v_area       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_bulk_inventory(v_uid) THEN
    RAISE EXCEPTION 'bulk_inventory_not_in_plan' USING ERRCODE = 'check_violation';
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: p_item_ids is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: p_updates must be a JSON object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_requested := array_length(p_item_ids, 1);

  -- Refuse the whole batch if any id is out of reach, rather than silently
  -- updating the subset that happens to be the caller's.
  SELECT COUNT(*) INTO v_accessible
  FROM public.inventory_items i
  WHERE i.id = ANY(p_item_ids)
    AND (i.user_id = v_uid
         OR (i.organization_id IS NOT NULL AND public.is_org_member(i.organization_id, v_uid)));

  IF v_accessible <> v_requested THEN
    RAISE EXCEPTION 'access_denied: some of those items are not yours'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_updates ? 'storage_area_id' THEN
    v_area := NULLIF(p_updates ->> 'storage_area_id', '')::UUID;
    IF v_area IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.storage_areas sa WHERE sa.id = v_area AND sa.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'access_denied: storage area % is not yours', v_area
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- `?` tests key presence, so a field the caller omitted is left alone and an
  -- explicit empty string clears it. Quantity is deliberately absent: it goes
  -- through bulk_adjust_quantity so it can never go negative.
  UPDATE public.inventory_items i
     SET category = CASE WHEN p_updates ? 'category'
                         THEN COALESCE(NULLIF(TRIM(p_updates ->> 'category'), ''), i.category)
                         ELSE i.category END,
         unit = CASE WHEN p_updates ? 'unit'
                     THEN COALESCE(NULLIF(TRIM(p_updates ->> 'unit'), ''), i.unit)
                     ELSE i.unit END,
         storage_area_id = CASE WHEN p_updates ? 'storage_area_id'
                                THEN NULLIF(p_updates ->> 'storage_area_id', '')::UUID
                                ELSE i.storage_area_id END,
         expiration_date = CASE WHEN p_updates ? 'expiration_date'
                                THEN NULLIF(p_updates ->> 'expiration_date', '')::DATE
                                ELSE i.expiration_date END,
         expiration_alert_days = CASE WHEN p_updates ? 'expiration_alert_days'
                                      THEN COALESCE((p_updates ->> 'expiration_alert_days')::INTEGER,
                                                    i.expiration_alert_days)
                                      ELSE i.expiration_alert_days END,
         updated_at = NOW()
   WHERE i.id = ANY(p_item_ids);

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  INSERT INTO public.inventory_transactions
    (user_id, actor_id, action, metadata)
  VALUES
    (v_uid, v_uid, 'bulk_update',
     jsonb_build_object('item_count', v_affected, 'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_updates) AS k)));

  RETURN v_affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_adjust_quantity(
  p_item_ids UUID[],
  p_delta    NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_accessible INTEGER;
  v_affected   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_bulk_inventory(v_uid) THEN
    RAISE EXCEPTION 'bulk_inventory_not_in_plan' USING ERRCODE = 'check_violation';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta: p_delta must be a non-zero number'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: p_item_ids is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_accessible
  FROM public.inventory_items i
  WHERE i.id = ANY(p_item_ids)
    AND (i.user_id = v_uid
         OR (i.organization_id IS NOT NULL AND public.is_org_member(i.organization_id, v_uid)));

  IF v_accessible <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'access_denied: some of those items are not yours'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- GREATEST(..., 0) keeps a bulk decrement from driving a quantity negative,
  -- matching the single-item ± control.
  UPDATE public.inventory_items i
     SET quantity   = GREATEST(COALESCE(i.quantity, 0) + p_delta, 0),
         updated_at = NOW()
   WHERE i.id = ANY(p_item_ids);

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_inventory(p_item_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_accessible INTEGER;
  v_affected   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_use_bulk_inventory(v_uid) THEN
    RAISE EXCEPTION 'bulk_inventory_not_in_plan' USING ERRCODE = 'check_violation';
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: p_item_ids is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_accessible
  FROM public.inventory_items i
  WHERE i.id = ANY(p_item_ids)
    AND (i.user_id = v_uid
         OR (i.organization_id IS NOT NULL AND public.can_manage_org(i.organization_id, v_uid)));

  IF v_accessible <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'access_denied: some of those items are not yours'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The AFTER DELETE trigger still records each removal before the row goes.
  DELETE FROM public.inventory_items WHERE id = ANY(p_item_ids);
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  INSERT INTO public.inventory_transactions (user_id, actor_id, action, metadata)
  VALUES (v_uid, v_uid, 'bulk_delete', jsonb_build_object('item_count', v_affected));

  RETURN v_affected;
END;
$$;

-- ============================================================================
-- 4. ONE DEFAULT STORAGE AREA PER ACCOUNT
-- ============================================================================
-- A plan that allows a single storage area must start with exactly one, or the
-- cap and the starting state disagree.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_default_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id TEXT;
  v_days    INTEGER;
  v_sub_id  UUID;
  v_area    TEXT;
  v_kind    TEXT;
BEGIN
  v_plan_id := CASE WHEN NEW.account_type = 'establishment'
                    THEN 'establishment_trial'
                    ELSE 'household_trial' END;

  SELECT duration_days INTO v_days
  FROM public.subscription_plans WHERE id = v_plan_id;
  v_days := COALESCE(v_days, 7);

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

  IF NEW.account_type = 'establishment' THEN
    v_area := 'Main Storage';
    v_kind := 'pantry';
  ELSE
    v_area := 'Refrigerator';
    v_kind := 'refrigerator';
  END IF;

  INSERT INTO public.storage_areas (user_id, name, kind, is_default)
  VALUES (NEW.id, v_area, v_kind, TRUE)
  ON CONFLICT (user_id, name) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Tidy up the surplus defaults created by the previous version of this trigger.
-- Only unattached areas on a single-area plan are removed, and the oldest area
-- is always kept so the account is never left with nowhere to put things.
WITH ranked AS (
  SELECT sa.id,
         sa.user_id,
         ROW_NUMBER() OVER (PARTITION BY sa.user_id ORDER BY sa.created_at, sa.name) AS rn
  FROM public.storage_areas sa
  WHERE sa.is_default = TRUE
    AND NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE ii.storage_area_id = sa.id)
    AND COALESCE(public.storage_area_limit(sa.user_id), 99) = 1
)
DELETE FROM public.storage_areas
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ============================================================================
-- 5. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_org_member_by_email(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_add_inventory(JSONB)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_inventory(UUID[], JSONB)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_adjust_quantity(UUID[], NUMERIC)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete_inventory(UUID[])          TO authenticated;

SELECT 'KeepFresh AI staff & bulk inventory ready' AS status;
