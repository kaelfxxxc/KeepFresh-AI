-- ============================================================================
-- KeepFresh AI — scheduled jobs
-- ============================================================================
-- Run this AFTER supabase/migrations/trial_expiration.sql.
--
-- Two jobs exist. They are split between the two files deliberately:
--
--   * keepfresh-subscription-expiry  — in trial_expiration.sql. It is a single
--     SQL statement, so it needs no edge function, no HTTP call and no key, and
--     it lives with the rest of the trial system.
--
--   * keepfresh-daily-expiration-check — this file. It has to call an edge
--     function, so it needs the project URL and a key, which is why it is the
--     one file you have to fill in by hand.
--
-- Before running, replace:
--   <YOUR-PROJECT-REF>  e.g. abcdefghijklmnop
--   <YOUR-ANON-KEY>     Project Settings -> API -> anon/public key
--
-- The anon key is safe to place here: it is the same key already shipped inside
-- the app, it grants nothing on its own, and `expiration-notifier` is declared
-- `verify_jwt = false` in supabase/config.toml precisely so this job can reach
-- it. Do NOT put a service-role key in this file.
--
-- NOTE: this file previously began mid-statement — the `SELECT cron.schedule(`
-- opener was missing, so it could never have applied. That is fixed here, and
-- every job is now unschedule-then-schedule so re-running is safe.
-- ============================================================================


-- ============================================================================
-- Extensions
-- ============================================================================
-- guarded so a project where the extension cannot be created here still gets a
-- clear message instead of an opaque failure.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be created (%). Enable it under Database -> Extensions, then re-run.', SQLERRM;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_net could not be created (%). Enable it under Database -> Extensions, then re-run.', SQLERRM;
  END;
END;
$$;


-- ============================================================================
-- Daily expiration reminder
-- ============================================================================
-- POSTs to the `expiration-notifier` edge function, which sweeps every user's
-- inventory and sends the "this is about to expire" reminders.
--
-- 08:07 rather than 08:00: every scheduled job on the platform defaulting to the
-- hour is a load spike nobody needs.

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'Skipping: pg_cron is not installed.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'keepfresh-daily-expiration-check') THEN
    PERFORM cron.unschedule('keepfresh-daily-expiration-check');
  END IF;

  PERFORM cron.schedule(
    'keepfresh-daily-expiration-check',
    '7 8 * * *',
    $cron$
      SELECT net.http_post(
        url     := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/expiration-notifier',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer <YOUR-ANON-KEY>'
        ),
        body    := '{}'::jsonb
      );
    $cron$
  );

  RAISE NOTICE 'Scheduled keepfresh-daily-expiration-check to run daily at 08:07.';
END;
$$;


-- ============================================================================
-- Verify
-- ============================================================================
-- Expect two rows: keepfresh-subscription-expiry (03:17) and
-- keepfresh-daily-expiration-check (08:07).

SELECT jobid, jobname, schedule, active, command
FROM cron.job
ORDER BY jobname;
