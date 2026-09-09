// Shared admin client. Runs with the service-role key so it can read/write any
// row regardless of RLS (never expose this key to the app).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Resolve the caller's user id from the Authorization header (used by the
// functions that are triggered by the mobile app). Returns null when absent.
export async function userIdFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
