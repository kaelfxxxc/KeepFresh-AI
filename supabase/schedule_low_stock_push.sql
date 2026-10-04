-- Enable pg_cron and pg_net under Database -> Extensions first.
-- Set the Supabase project URL and LOW_STOCK_CRON_SECRET below before running.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'Enable pg_cron before scheduling low stock push delivery.';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'keepfresh-low-stock-push') THEN
    PERFORM cron.unschedule('keepfresh-low-stock-push');
  END IF;

  PERFORM cron.schedule(
    'keepfresh-low-stock-push',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/low-stock-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '<LOW_STOCK_CRON_SECRET>'
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END;
$$;

SELECT jobid, jobname, schedule, active
FROM cron.job WHERE jobname = 'keepfresh-low-stock-push';
