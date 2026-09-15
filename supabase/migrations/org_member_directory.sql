CREATE OR REPLACE FUNCTION public.shares_org_with(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members mine
    JOIN public.organization_members theirs
      ON theirs.organization_id = mine.organization_id
    WHERE mine.user_id = auth.uid()
      AND mine.status = 'active'
      AND theirs.user_id = p_other
      AND theirs.status = 'active'
  );
$$;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.shares_org_with(id)
  );

GRANT EXECUTE ON FUNCTION public.shares_org_with(UUID) TO authenticated;

SELECT 'KeepFresh AI organisation directory ready' AS status;
