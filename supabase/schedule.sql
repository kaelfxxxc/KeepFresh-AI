-- ============================================================================
-- KeepFresh AI - schedule the expiration-notifier Edge Function
-- Runs the function every day at 08:07 (off the busy top-of-the-hour).
-- Requires the pg_cron and pg_net extensions:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;   (also enabled on Supabase UI:
--    Database -> Extensions -> enable "pg_cron" and "pg_net")
--
-- Alternative without SQL: Supabase Dashboard -> Edge Functions ->
-- expiration-notifier -> Cron -> create "Daily at 08:07". Same effect.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Replace <YOUR-PROJECT-REF> (the subdomain in https://<ref>.supabase.co).
-- Use the ANON key here (never the service role key in cron): the function
-- itself uses the service role internally, and verify_jwt is false.
SELECT cron.schedule(
  'keepfresh-daily-expiration-check',
  '7 8 * * *',
  $$
    SELECT net.http_post(
      url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/expiration-notifier',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <YOUR-ANON-KEY>'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- See recent runs:
--   SELECT * FROM cron.job_run_details WHERE jobname = 'keepfresh-daily-expiration-check' ORDER BY start_time DESC LIMIT 10;
-- Stop it:
--   SELECT cron.unschedule('keepfresh-daily-expiration-check');
