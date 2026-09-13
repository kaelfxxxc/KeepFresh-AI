// expiration-notifier
// The daily server-side sweep. Runs on a schedule (pg_cron or a Supabase cron
// trigger) and does three things:
//
//   1. Expires subscriptions whose period has ended, so a lapsed plan stops
//      granting premium features even for a user who never opens the app.
//      Inventory is never touched — only the entitlement.
//   2. Logs an expiration notification for every item inside its own alert
//      window (`inventory_items.expiration_alert_days`, falling back to the
//      account-wide `notification_preferences.days_before`).
//   3. Logs the same for items that have already expired, so one ignored
//      warning still becomes a second, clearer one.
//
// De-duplication is done by the `log_notification` RPC, which inserts only if
// this exact occasion has not been logged before. That replaces the previous
// read-then-insert check, which two concurrent runs could both pass.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/expiration-notifier \
//     -H "Authorization: Bearer $SUPABASE_ANON_KEY"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

/** Whole days from today's local midnight to a `YYYY-MM-DD` date. */
function daysUntil(dateOnly: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateOnly}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function isoDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    // ---- 1. Lapse anything whose period is over --------------------------
    // Runs before the notifications so a plan that just expired is already
    // reflected in what each user is entitled to.
    let expiredSubscriptions = 0;
    const { data: expireResult, error: expireError } = await supabaseAdmin
      .rpc('expire_stale_subscriptions');
    if (expireError) {
      // A failure here must not stop the notifications below; report it.
      console.error('expiration-notifier: expire_stale_subscriptions failed', expireError);
    } else {
      expiredSubscriptions = Number(expireResult ?? 0);
    }

    // ---- 2. Gather what needs a nudge ------------------------------------
    const { data: items, error: itemErr } = await supabaseAdmin
      .from('inventory_items')
      .select('id, user_id, product_name, expiration_date, quantity, unit, expiration_alert_days')
      .not('expiration_date', 'is', null)
      .not('status', 'in', '("consumed","wasted")')
      .lte('expiration_date', "now()::date + interval '30 days'");
    if (itemErr) throw itemErr;

    const byUser = new Map<string, typeof items>();
    for (const item of items ?? []) {
      if (!byUser.has(item.user_id)) byUser.set(item.user_id, []);
      byUser.get(item.user_id)!.push(item);
    }

    const { data: prefs, error: prefErr } = await supabaseAdmin
      .from('notification_preferences')
      .select('user_id, enabled, days_before');
    if (prefErr) throw prefErr;

    const today = isoDay();
    let logged = 0;
    let skipped = 0;

    for (const pref of prefs ?? []) {
      if (!pref.enabled) continue;

      const candidates = byUser.get(pref.user_id) ?? [];
      const accountWindow = Number(pref.days_before ?? 3);

      for (const item of candidates) {
        const daysLeft = daysUntil(item.expiration_date);

        // Per-item timing wins: the user set it for this product. The account
        // default only fills in for items that predate the column.
        const window = Number(item.expiration_alert_days ?? accountWindow);

        // Expired items are always worth mentioning; upcoming ones only once
        // they are inside their own window.
        const expired = daysLeft < 0;
        if (!expired && daysLeft > window) continue;

        const name = item.product_name || 'An item';
        const title = expired ? 'Expired' : daysLeft === 0 ? 'Expires today' : 'Expiring soon';
        const body = expired
          ? `${name} expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago.`
          : daysLeft === 0
            ? `${name} expires today. Use it or freeze it.`
            : `${name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;

        // One occasion per item per day, and a separate one once it has
        // actually expired, so the two never collapse into a single message.
        const dedupeKey = `${expired ? 'expired' : 'expiration'}:${item.id}:${today}`;

        const { data: maySend, error: logError } = await supabaseAdmin.rpc('log_notification', {
          p_user_id: item.user_id,
          p_notification_type: expired ? 'expired' : 'expiration',
          p_dedupe_key: dedupeKey,
          p_inventory_item_id: item.id,
          p_title: title,
          p_body: body,
        });

        if (logError) {
          console.error('expiration-notifier: log_notification failed', logError);
          continue;
        }
        if (maySend) logged += 1;
        else skipped += 1;
      }
    }

    return json(
      {
        ok: true,
        expired_subscriptions: expiredSubscriptions,
        notifications_logged: logged,
        notifications_already_sent: skipped,
        next_run: 'daily recommended',
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500, corsHeaders);
  }
});
