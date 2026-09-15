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

SELECT jobid, jobname, schedule, active, command
FROM cron.job
ORDER BY jobname;
