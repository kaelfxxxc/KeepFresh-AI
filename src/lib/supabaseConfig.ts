import Constants from 'expo-constants';

/**
 * Single source of truth for how the app finds its Supabase project.
 *
 * This file exists because of a production-only crash. `createClient()` throws
 * `supabaseUrl is required.` the moment it is handed an empty URL, and it used
 * to be called at module scope — so any build whose environment variables did
 * not survive into the bundle died while modules were still being evaluated,
 * before React ever mounted. That surfaced as a fatal
 * `Error: supabaseUrl is required.` plus a confusing cascading
 * `Cannot read property 'ErrorBoundary' of undefined`, because expo-router's
 * error path read `ErrorBoundary` off a half-initialised module.
 *
 * The values are resolved from two independent channels, so a build only has to
 * get one of them right:
 *
 *   1. `process.env.EXPO_PUBLIC_*` — inlined into the bundle by Metro at build
 *      time. This is the normal path in development, and in any release build
 *      whose build environment actually carries the variables.
 *   2. `Constants.expoConfig.extra.*` — written by `app.config.js` at prebuild
 *      time and embedded in the native manifest, then read back at runtime.
 *      Because it travels with the native config rather than the JS bundle, it
 *      still works when Metro's env inlining substitutes nothing.
 *
 * Nothing is ever faked here: when both channels come up empty the app reports
 * exactly which variables are missing instead of inventing a placeholder host.
 */

/** Keys injected into `extra` by `app.config.js`. */
interface SupabaseExtra {
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Which channel supplied the values. Useful when reading a support log. */
  source: 'env' | 'app-config';
}

export interface SupabaseConfigProblem {
  ok: false;
  /** The `EXPO_PUBLIC_*` variable names that are missing or unusable. */
  missing: string[];
  /** A ready-to-display explanation, including how to fix it. */
  message: string;
}

export type SupabaseConfigResult = ({ ok: true } & SupabaseConfig) | SupabaseConfigProblem;

export class SupabaseConfigError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = 'SupabaseConfigError';
    this.missing = missing;
  }
}

/**
 * Strings that mean "the build never substituted a real value here". Babel
 * inlines an unset `process.env.X` reference as the literal `undefined`, and a
 * `.env` line of `X=undefined` produces the same thing, so both are treated as
 * absent rather than as a hostname or a key.
 */
const ABSENT = new Set(['', 'undefined', 'null', 'nan']);

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ABSENT.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** A real absolute http(s) URL — rejects `''`, a bare host, a path fragment. */
function isUsableUrl(value: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(value);
}

function readExtra(): SupabaseExtra {
  return (Constants.expoConfig?.extra ?? {}) as SupabaseExtra;
}

function describe(missing: string[]): string {
  return [
    `Supabase is not configured in this build — missing or unusable: ${missing.join(', ')}.`,
    '',
    'Local development reads these from .env in the project root.',
    'Release builds need them in the build environment itself. For EAS Build:',
    '',
    '  eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value <your-project-url> \\',
    '    --environment production --environment preview --visibility plaintext',
    '  eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <your-anon-key> \\',
    '    --environment production --environment preview --visibility plaintext',
    '',
    'Only the public anon/publishable key belongs in the app — never service_role.',
  ].join('\n');
}

/**
 * Resolve the Supabase settings, or describe precisely what is missing.
 *
 * Never throws: callers decide how to surface the problem, and the root layout
 * needs an answer it can render rather than an exception.
 */
export function resolveSupabaseConfig(): SupabaseConfigResult {
  const extra = readExtra();

  // The canonical name wins; `EXPO_PUBLIC_SUPABASE_PROJECT_URL` is the older
  // spelling this project shipped with and is still accepted.
  const envUrl =
    readString(process.env.EXPO_PUBLIC_SUPABASE_URL) ??
    readString(process.env.EXPO_PUBLIC_SUPABASE_PROJECT_URL);
  const envKey = readString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

  const url = envUrl ?? readString(extra.supabaseUrl);
  const anonKey = envKey ?? readString(extra.supabaseAnonKey);

  const missing: string[] = [];
  if (!url) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!anonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return { ok: false, missing, message: describe(missing) };
  }

  // Both are present, but a value that is not a URL is just as fatal as a
  // missing one — `createClient` would build requests against a bogus host.
  if (!isUsableUrl(url)) {
    return {
      ok: false,
      missing: ['EXPO_PUBLIC_SUPABASE_URL'],
      message: describe(['EXPO_PUBLIC_SUPABASE_URL']),
    };
  }

  return { ok: true, url, anonKey, source: envUrl ? 'env' : 'app-config' };
}
