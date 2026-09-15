CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
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