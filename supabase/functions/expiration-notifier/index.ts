// expiration-notifier
// Scans every user's inventory and logs notifications for items expiring within
// each user's configured warning window (notification_preferences.days_before).
// Intended to run on a schedule (pg_cron or a Supabase cron trigger), then hand
// the returned payload to push/email. Idempotent: skips items already logged
// for the same user/item/type today, so running it daily never spams.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/expiration-notifier \
//     -H "Authorization: Bearer $SUPABASE_ANON_KEY"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    // Every inventory item that still has an upcoming or just-passed expiry
    // and is still in the pantry.
    const { data: items, error: itemErr } = await supabaseAdmin
      .from('inventory_items')
      .select('id, user_id, product_name, expiration_date, quantity, unit')
      .not('expiration_date', 'is', null)
      .not('status', 'in', '("consumed","wasted")')
      .lte('expiration_date', 'now()::date + interval \'30 days\'');

    if (itemErr) throw itemErr;

    const byUser = new Map<string, typeof items>();
    for (const it of items ?? []) {
      if (!byUser.has(it.user_id)) byUser.set(it.user_id, []);
      byUser.get(it.user_id)!.push(it);
    }

    const { data: prefs, error: prefErr } = await supabaseAdmin
      .from('notification_preferences')
      .select('user_id, enabled, days_before');
    if (prefErr) throw prefErr;

    const notifications: Array<Record<string, unknown>> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const p of prefs ?? []) {
      if (!p.enabled) continue;
      const candidates = byUser.get(p.user_id) ?? [];

      for (const it of candidates) {
        const exp = new Date(it.expiration_date);
        const daysLeft = Math.round((exp.getTime() - today.getTime()) / 86_400_000);

        // Only notify items that are already expired or inside the user window.
        if (daysLeft > p.days_before) continue;

        const { data: dup } = await supabaseAdmin
          .from('notification_logs')
          .select('id')
          .eq('user_id', p.user_id)
          .eq('inventory_item_id', it.id)
          .eq('notification_type', 'expiration')
          .gte('sent_at', `${today.toISOString().slice(0, 10)} 00:00:00`);
        if (dup && dup.length > 0) continue; // already nudged today

        notifications.push({
          user_id: p.user_id,
          inventory_item_id: it.id,
          notification_type: 'expiration',
          sent_at: new Date().toISOString(),
        });
      }
    }

    if (notifications.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from('notification_logs')
        .insert(notifications);
      if (insErr) throw insErr;
    }

    return json({
      ok: true,
      processed_users: prefs?.filter((p) => p.enabled).length ?? 0,
      notifications_logged: notifications.length,
      next_run: 'daily recommended',
    }, 200, corsHeaders);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500, corsHeaders);
  }
});
