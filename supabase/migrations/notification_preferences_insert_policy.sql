-- Let each signed-in user create their own notification settings row.
-- Existing installations had SELECT and UPDATE policies but no INSERT policy,
-- which made the app's first save fail when signup had not seeded a row.
DROP POLICY IF EXISTS "Users can insert own notification prefs" ON public.notification_preferences;
CREATE POLICY "Users can insert own notification prefs" ON public.notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

