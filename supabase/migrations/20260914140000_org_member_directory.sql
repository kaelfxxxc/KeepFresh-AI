-- ============================================================================
-- KeepFresh AI — Organisation member directory
-- ============================================================================
-- The staff screen needs to show who is on the team, but the `profiles` policy
-- only exposes a user's own row. Reading a colleague's name is legitimate, so
-- this opens exactly that door and nothing wider: you can see the profile of
-- someone who shares an active organisation with you.
--
-- `shares_org_with` is SECURITY DEFINER so the policy that calls it does not
-- recurse back into organization_members' own policies.
-- ============================================================================

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
