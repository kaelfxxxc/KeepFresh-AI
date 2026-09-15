BEGIN;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS need_to_buy BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.inventory_items.need_to_buy IS
  'User flagged this item as something to buy more of. Independent of status: the item can still be in stock. Cleared automatically when the quantity goes up (see adjust_inventory_quantity / bulk_adjust_quantity).';
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
         -- `inventory_items.need_to_buy` on the right is the pre-update value:
         -- Postgres evaluates every SET expression against the old row.
         need_to_buy = CASE
           WHEN v_after > v_before THEN FALSE
           ELSE inventory_items.need_to_buy
         END,
         updated_at = NOW()
   WHERE id = p_item_id
  RETURNING * INTO v_row;

  RETURN v_row;
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
         need_to_buy = CASE
           WHEN GREATEST(COALESCE(i.quantity, 0) + p_delta, 0) > COALESCE(i.quantity, 0)
             THEN FALSE
           ELSE i.need_to_buy
         END,
         updated_at = NOW()
   WHERE i.id = ANY(p_item_ids);

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

COMMIT;