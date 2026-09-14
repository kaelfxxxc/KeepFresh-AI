DO $$
DECLARE
  -- Every SECURITY DEFINER routine added for subscriptions, entitlements,
  -- storage areas, staff and bulk inventory.
  fn TEXT;
  routines TEXT[] := ARRAY[
    -- Entitlement reads
    'public.get_user_entitlements(uuid)',
    'public.can_add_product(uuid)',
    'public.can_use_ai_scan(uuid)',
    'public.can_use_price_tracking(uuid)',
    'public.can_use_waste_report(boolean, uuid)',
    'public.can_use_multiple_storage(uuid)',
    'public.can_use_staff_management(uuid)',
    'public.can_use_bulk_inventory(uuid)',
    'public.storage_area_limit(uuid)',
    -- Entitlement-consuming writes
    'public.consume_ai_scan(uuid)',
    'public.adjust_inventory_quantity(uuid, numeric)',
    -- Notifications and self-service subscription actions
    'public.log_notification(uuid, text, text, uuid, text, text)',
    'public.cancel_my_subscription(boolean)',
    'public.expire_stale_subscriptions()',
    -- Organisation helpers (also used inside RLS policies, which run as the
    -- querying role — hence the explicit grant to `authenticated` below)
    'public.is_org_member(uuid, uuid)',
    'public.org_role(uuid, uuid)',
    'public.can_manage_org(uuid, uuid)',
    'public.shares_org_with(uuid)',
    -- Organisation mutations
    'public.create_organization(text)',
    'public.add_org_member_by_email(uuid, text, text)',
    -- Bulk inventory
    'public.bulk_add_inventory(jsonb)',
    'public.bulk_update_inventory(uuid[], jsonb)',
    'public.bulk_adjust_quantity(uuid[], numeric)',
    'public.bulk_delete_inventory(uuid[])',
    -- Trigger functions
    'public.guard_subscription_update()',
    'public.log_inventory_transaction()',
    'public.log_initial_price()',
    'public.enforce_inventory_entitlements()',
    'public.enforce_storage_area_limit()',
    'public.grant_default_entitlements()'
  ];
BEGIN
  FOREACH fn IN ARRAY routines
  LOOP
    -- A function missing from this deployment should not abort the migration;
    -- the loop simply skips it.
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'skipping % (not present)', fn;
    END;
  END LOOP;
END;
$$;

-- ============================================================================
-- The pre-existing RPCs from keepfreshdb.sql
-- ============================================================================
-- Their bodies already reject an anon caller (`auth.uid() IS NULL OR ...`), so
-- they are not exploitable — but an unauthenticated request should not be able
-- to reach a user-data function at all. Same treatment for consistency.
-- `get_recipe_matches` is included even though recipes are not user data: it is
-- only ever called from a signed-in screen.
-- ============================================================================

DO $$
DECLARE
  fn TEXT;
  routines TEXT[] := ARRAY[
    'public.get_expiring_items(uuid, integer)',
    'public.calculate_food_waste(uuid, date, date)',
    'public.calculate_food_consumption(uuid, date, date)',
    'public.calculate_estimated_savings(uuid, date, date)',
    'public.consume_inventory_item(uuid, uuid, numeric)',
    'public.get_recipe_matches(uuid, text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY routines
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'skipping % (not present)', fn;
    END;
  END LOOP;
END;
$$;

-- ============================================================================
-- Verify: no routine above should still be executable by `anon`.
-- ============================================================================

DO $$
DECLARE
  v_leaks TEXT;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ')
    INTO v_leaks
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_user_entitlements', 'can_add_product', 'can_use_ai_scan',
      'can_use_price_tracking', 'can_use_waste_report', 'can_use_multiple_storage',
      'can_use_staff_management', 'can_use_bulk_inventory', 'storage_area_limit',
      'consume_ai_scan', 'adjust_inventory_quantity', 'log_notification',
      'cancel_my_subscription', 'expire_stale_subscriptions',
      'is_org_member', 'org_role', 'can_manage_org', 'shares_org_with',
      'create_organization', 'add_org_member_by_email',
      'bulk_add_inventory', 'bulk_update_inventory', 'bulk_adjust_quantity',
      'bulk_delete_inventory', 'consume_inventory_item', 'get_expiring_items'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_leaks IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still execute: %', v_leaks;
  END IF;
END;
$$;

SELECT 'KeepFresh AI function privileges hardened' AS status;
