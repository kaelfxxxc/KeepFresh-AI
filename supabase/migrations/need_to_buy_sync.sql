CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_item_id UUID,
  p_delta   NUMERIC
)
RETURNS public.inventory_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.inventory_items;
  v_before NUMERIC;
  v_after  NUMERIC;
  v_status TEXT;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta: p_delta must be a non-zero number'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_row FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'item_not_found: no inventory item with id %', p_item_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS NOT NULL
     AND v_row.user_id <> auth.uid()
     AND NOT (v_row.organization_id IS NOT NULL
              AND public.is_org_member(v_row.organization_id, auth.uid())) THEN
    RAISE EXCEPTION 'access_denied: not your inventory'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_before := COALESCE(v_row.quantity, 0);
  v_after  := GREATEST(v_before + p_delta, 0);

  -- The status follows the quantity, which is what keeps Need to Buy in step.
  --
  -- The two directions are deliberately not symmetric. Reaching zero marks an
  -- available item 'consumed' so it joins Need to Buy — but a row that was
  -- already 'wasted' keeps that status, because 'wasted' satisfies the filter
  -- just as well and overwriting it would erase why the item left the pantry.
  -- Going back above zero revives anything that had finished, been thrown out or
  -- expired: restocking means there is food on the shelf again, which is exactly
  -- what should remove it from Need to Buy.
  v_status := CASE
    WHEN v_after > 0 AND v_row.status IN ('consumed', 'wasted', 'expired')
      THEN 'available'
    WHEN v_after <= 0 AND v_row.status = 'available'
      THEN 'consumed'
    ELSE v_row.status
  END;

  UPDATE public.inventory_items
     SET quantity   = v_after,
         status     = v_status,
         updated_at = NOW()
   WHERE id = p_item_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- bulk_adjust_quantity — the same rule, applied per row.
--
-- Set-based rather than looping, so the CASE reads `i.status` from each row as
-- the UPDATE walks them. In Postgres the right-hand side of a SET sees the
-- pre-update values, so `i.quantity` here is the quantity before the delta.
-- ---------------------------------------------------------------------------
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
  -- matching the single-item ± control. The status rule mirrors
  -- adjust_inventory_quantity so a bulk edit and a single tap cannot disagree.
  UPDATE public.inventory_items i
     SET quantity   = GREATEST(COALESCE(i.quantity, 0) + p_delta, 0),
         status     = CASE
           WHEN GREATEST(COALESCE(i.quantity, 0) + p_delta, 0) > 0
                AND i.status IN ('consumed', 'wasted', 'expired')
             THEN 'available'
           WHEN GREATEST(COALESCE(i.quantity, 0) + p_delta, 0) <= 0
                AND i.status = 'available'
             THEN 'consumed'
           ELSE i.status
         END,
         updated_at = NOW()
   WHERE i.id = ANY(p_item_ids);

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: rows that already ran out before this fix are still marked
-- 'available' with a quantity of zero, so they are invisible under Need to Buy.
-- Bring them into line with what the functions above would now produce.
--
-- Only rows at zero are touched, and only from 'available' — an item already
-- 'consumed' or 'wasted' is left exactly as it is.
-- ---------------------------------------------------------------------------
UPDATE public.inventory_items
   SET status     = 'consumed',
       updated_at = NOW()
 WHERE status = 'available'
   AND COALESCE(quantity, 0) <= 0;
