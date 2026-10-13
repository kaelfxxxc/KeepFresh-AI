# KeepFresh AI SMS Gateway setup

This project uses the SMS Gateway for Android public Cloud Server with a Philippine SIM. KeepFresh queues messages in Supabase and a scheduled Edge Function submits them to SMS Gate. The Android phone must have internet, SMS permission, working carrier service, and remain online for delivery.

## 1. Prepare the gateway phone

1. Insert and activate the Globe, Smart, or DITO SIM. Confirm it can send an ordinary SMS and has sufficient load or an SMS plan.
2. Keep Android and Google Play Services up to date. Disable battery optimization for SMS Gateway for Android and allow background data and notifications.
3. Open SMS Gateway for Android, enable **Cloud Server**, then tap **Offline** to connect. Wait until the indicator reads **Online**.
4. In the Cloud Server section, copy the generated username and password. Store them in a password manager. Do not put them in the app, source control, Expo variables, or a client `.env` file.
5. In `https://dashboard.sms-gate.app`, sign in with those credentials and confirm the gateway device is listed and online.
6. Send a test SMS to a number you control from the dashboard/API. Confirm the phone sends it and the message appears in its history.

Cloud Mode uses FCM push, an SSE fallback, and scheduled polling. It needs internet access. If using SSE Only, the app documents a persistent notification and increased battery use. SMS delivery can be delayed or blocked by SIM balance, carrier rules, device power management, or loss of connectivity.

## 2. Apply the database migration

Apply the existing schema first, including `philippines_phone_number.sql`, subscription/notification migrations, and `low_stock_push_alerts.sql`. This repository contains legacy SQL files that may not all be in Supabase CLI timestamp migration format. Apply the required SQL in Supabase SQL Editor in that order, then apply `supabase/migrations/sms_gateway.sql`:

```sh
supabase db push
```

Use `supabase db push` only after checking that the project migration history includes these prerequisites. Otherwise paste/run the SQL files through Supabase SQL Editor in order. `sms_gateway.sql` adds the SMS queue/history, private OTP challenge table, notification consent fields, verified phone timestamp, and a low-stock event trigger. The queue and OTP challenge tables have no client write access; users can only read their own SMS history.

## 3. Set server secrets

Generate two independent random secrets (at least 32 random bytes each), then configure Supabase Edge Function secrets:

```sh
supabase secrets set \
  SMSGATE_USERNAME='cloud-mode-username' \
  SMSGATE_PASSWORD='cloud-mode-password' \
  SMS_CRON_SECRET='long-random-dispatch-secret' \
  SMSGATE_WEBHOOK_SECRET='different-long-random-webhook-secret' \
  OTP_PEPPER='another-long-random-secret'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to hosted functions by Supabase. Never set a service role key in the mobile app. Rotate the SMS Gate password and corresponding Supabase secret if the phone/account is reset.

## 4. Deploy the functions

```sh
supabase functions deploy sms-otp
supabase functions deploy sms-dispatch
supabase functions deploy sms-status-webhook
supabase functions deploy low-stock-push
supabase functions deploy expiration-notifier
```

`sms-otp` requires a signed-in Supabase user. `sms-dispatch` and `sms-status-webhook` have JWT verification disabled because they authenticate with their own secrets. Dispatch only accepts a private cron secret and drains approved server-created queue rows; it does not accept recipient or message text from app callers.

## 5. Configure status callback

In the SMS Gate Web Dashboard, create a webhook for message status events. Set its URL to:

```text
https://<PROJECT-REF>.supabase.co/functions/v1/sms-status-webhook
```

Configure the webhook to send `x-keepfresh-webhook-secret: <SMSGATE_WEBHOOK_SECRET>` and subscribe to message status updates. The handler maps provider message IDs to the internal SMS history row and records sent, delivered, or failed status. Confirm the dashboard supports custom headers before enabling this callback; if it cannot send a header, use a private webhook relay that adds the header and keep the function endpoint secret. Do not leave the callback unauthenticated.

The official SMS Gate Cloud Mode docs show Basic authentication for `POST https://api.sms-gate.app/3rdparty/v1/messages` with `textMessage.text` and `phoneNumbers`; the docs recommend JWT for new integrations. This implementation uses the documented Cloud Mode Basic credentials kept only in Supabase secrets. If you create scoped JWT credentials in the dashboard, the dispatcher can be updated to use them instead.

## 6. Schedule queue delivery and expiration checks

Enable `pg_cron` and `pg_net` in Supabase Database → Extensions. In Supabase SQL Editor, schedule frequent queue draining (replace the URL ref and secret):

```sql
select cron.schedule(
  'keepfresh-sms-dispatch', '* * * * *',
  $$select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/sms-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<SMS_CRON_SECRET>'),
    body := '{}'::jsonb
  );$$
);
```

Schedule the existing `expiration-notifier` daily using `supabase/migrations/schedule.sql` (replace its project ref and anon key placeholders). That worker keeps existing in-app expiration behavior and queues SMS only for opted-in, verified numbers on their selected offsets. Low-stock queue events are created by a database trigger and picked up by the existing every-minute `low-stock-push` worker, which now also queues SMS. Configure `LOW_STOCK_CRON_SECRET` and schedule that worker as described in `supabase/migrations/schedule_low_stock_push.sql`.

Check active jobs with:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

## 7. User setup and opt-in

In KeepFresh AI open **Settings → Notifications → SMS notifications**. Enter the 10 digits after `+63`, request the verification code, enter the six digit code within five minutes, and verify. Then select **All SMS alerts** and the specific low stock, expiration, or subscription alert types, and save. SMS remains off until the user explicitly opts in. A verified number is required; signup and existing Supabase Auth flows are unchanged.

## 8. Operations and checks

1. Confirm the gateway reads Online and send a dashboard test to a controlled phone.
2. In app settings verify a number you control; confirm the OTP arrives, rejects a wrong code, and expires after five minutes. Resend is limited to once per minute and five sends per phone per hour; challenges allow at most five attempts.
3. Enable SMS low-stock alerts, set a test product threshold, restock above it, then reduce quantity below it. Confirm one queue row and one message; repeat edits while still low to confirm no duplicate.
4. Enable expiration SMS, set an item expiration to one of the configured offsets (default 3, 1, or 0 days), then invoke the scheduled expiration function. Confirm one queue row for that event.
5. Inspect **Settings → Notifications** preferences and `sms_messages` as the user. Status progresses from Pending to Sent and then Delivered/Failed when SMS Gate callbacks arrive. If no callback is configured, Sent indicates gateway API acceptance only.
6. Disconnect the phone from the internet and verify queue retry behavior. Restore service and check that pending messages deliver. Failed messages stop retrying after five attempts.

### Current integration scope

- Phone verification is available from notification settings; registration remains email/password Supabase Auth. The OTP flow is an additional phone verification step and does not change auth credentials.
- Low stock and food expiration reminders are wired to the existing scheduled backend workflows.
- The subscription preference is stored for future subscription event producers. The current codebase does not yet emit subscription lifecycle events to the SMS queue; add those from verified subscription activation and expiration backend paths before enabling that category in production.
- SMS status logs show only rows for the signed-in user. The SMS message body is retained for history; apply your data retention policy before production.

## Official references

- [SMS Gate Cloud Server](https://docs.sms-gate.app/getting-started/public-cloud-server/)
- [SMS Gate API](https://docs.sms-gate.app/integration/api/)
- [SMS Gate authentication](https://docs.sms-gate.app/integration/authentication/)
- [SMS Gate webhooks](https://docs.sms-gate.app/getting-started/webhooks/)
- [SMS Gate status tracking](https://docs.sms-gate.app/features/status-tracking/)
