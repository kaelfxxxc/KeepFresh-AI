/**
 * Extends the static app.json with the Supabase credentials at build time.
 *
 * app.json stays the single source of truth for everything else — this file only
 * adds `extra.supabaseUrl` / `extra.supabaseAnonKey`, which are read back at
 * runtime by `src/lib/supabaseConfig.ts` via expo-constants.
 *
 * Why both this and the EXPO_PUBLIC_* env vars: they are independent channels.
 * The env vars are inlined into the JS bundle by Metro; these values are baked
 * into the native manifest at prebuild time. A release build only has to get one
 * of them right, which is what stops a misconfigured build from crashing before
 * React mounts.
 *
 * Only the public anon/publishable key belongs here. The service-role key must
 * never reach the app — it lives in the Supabase project's own secrets.
 */

const appJson = require('./app.json');

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_PROJECT_URL ||
  '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  // A warning rather than a hard failure, so an intentional build with no
  // backend still produces an app — one that shows a clear configuration error
  // screen instead of crashing. If you see this during `eas build`, the build
  // environment is missing the variables: set them with `eas env:create`.
  const missing = [
    !supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL',
    !supabaseAnonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);

  console.warn(
    '[app.config] Supabase credentials are not available in this build environment. ' +
      'Missing: ' +
      missing.join(', ') +
      '. The native config will omit them and the app will report a configuration ' +
      'error at launch instead of crashing.'
  );
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    // Omitted entirely when unset, so `npx expo config` shows the absence
    // plainly rather than an empty string that looks like a real value.
    ...(supabaseUrl ? { supabaseUrl } : {}),
    ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
  },
});
