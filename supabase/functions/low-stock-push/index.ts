// Delivers low stock events created by the inventory trigger. The database is
// the source of truth for plan eligibility; this worker only sends Expo pushes.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

type EventRow = {
  id: number;
  user_id: string;
  inventory_item_id: string;
  quantity: number;
  threshold: number;
};

async function closeEvent(id: number, status: 'sent' | 'pending') {
  const { error } = await supabaseAdmin.from('low_stock_push_events')
    .update({ status }).eq('id', id);
  if (error) throw error;
}

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const cronSecret = Deno.env.get('LOW_STOCK_CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401, corsHeaders);
  }

  try {
    // Recover claims left behind if a worker process stopped mid-event.
    const { error: recoveryError } = await supabaseAdmin.from('low_stock_push_events')
      .update({ status: 'pending' }).eq('status', 'processing')
      .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
    if (recoveryError) throw recoveryError;

    const { data: candidates, error } = await supabaseAdmin
      .from('low_stock_push_events').select('id, user_id, inventory_item_id, quantity, threshold')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    for (const candidate of (candidates ?? []) as EventRow[]) {
      const { data: claimed, error: claimError } = await supabaseAdmin
        .rpc('claim_low_stock_push_event', { p_id: candidate.id });
      if (claimError) throw claimError;
      const event = (claimed?.[0] ?? null) as EventRow | null;
      if (!event) continue;

      try {
        const [{ data: entitlement, error: entitlementError }, { data: pref, error: prefError },
          { data: item, error: itemError }] = await Promise.all([
          supabaseAdmin.rpc('get_user_entitlements', { p_user_id: event.user_id }),
          supabaseAdmin.from('notification_preferences').select('low_stock_enabled')
            .eq('user_id', event.user_id).maybeSingle(),
          supabaseAdmin.from('inventory_items').select('user_id, product_name, quantity, unit, low_stock_threshold, status')
            .eq('id', event.inventory_item_id).maybeSingle(),
        ]);
        if (entitlementError) throw entitlementError;
        if (prefError) throw prefError;
        if (itemError) throw itemError;

        const stillLow = item?.status === 'available'
          && item.user_id === event.user_id
          && Number(item.quantity ?? 0) <= Number(item.low_stock_threshold ?? 2);
        if (!stillLow) {
          await closeEvent(event.id, 'sent');
          skipped += 1;
          continue;
        }

        const productName = item.product_name || 'An item';
        const title = 'Low stock — restock needed';
        const body = `${productName} is low at ${item.quantity} ${item.unit}; restock soon (threshold: ${item.low_stock_threshold} ${item.unit}).`;

        const planEligible = entitlement?.is_active === true
          && entitlement?.tier === 'pro'
          && (entitlement?.is_verified_paid === true || entitlement?.provider === 'manual');
        if (!planEligible) {
          await closeEvent(event.id, 'sent');
          skipped += 1;
          continue;
        }

        // Log for both household and establishment Pro accounts. OS push is
        // independently controlled by the user's device permission and opt-in.
        const { error: logError } = await supabaseAdmin.rpc('log_notification', {
          p_user_id: event.user_id,
          p_notification_type: 'low_inventory',
          p_dedupe_key: `low_stock:${event.id}`,
          p_inventory_item_id: event.inventory_item_id,
          p_title: title,
          p_body: body,
        });
        if (logError) throw logError;

        const pushEligible = pref?.low_stock_enabled === true;
        if (!pushEligible) {
          await closeEvent(event.id, 'sent');
          skipped += 1;
          continue;
        }

        const { data: tokens, error: tokenError } = await supabaseAdmin
          .from('push_tokens').select('expo_push_token').eq('user_id', event.user_id);
        if (tokenError) throw tokenError;
        const pushTokens = (tokens ?? []).map((row) => row.expo_push_token as string);
        if (!pushTokens.length) {
          await closeEvent(event.id, 'sent');
          skipped += 1;
          continue;
        }

        const messages = pushTokens.map((to) => ({
          to,
          title,
          body,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data: {
            app: 'keepfresh',
            kind: 'low_inventory',
            dedupeKey: `low_stock:${event.id}`,
            itemId: event.inventory_item_id,
          },
        }));

        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });
        if (!response.ok) throw new Error(`Expo push API returned ${response.status}`);
        const result = await response.json();
        const tickets = result.data ?? [];
        const accepted = tickets.some((ticket: { status?: string }) => ticket.status === 'ok');
        if (!accepted) throw new Error('Expo did not accept any low stock push');

        for (let index = 0; index < tickets.length; index += 1) {
          if (tickets[index]?.details?.error === 'DeviceNotRegistered') {
            await supabaseAdmin.from('push_tokens').delete()
              .eq('expo_push_token', pushTokens[index]);
          }
        }

        await closeEvent(event.id, 'sent');
        sent += 1;
      } catch (eventError) {
        console.error('low-stock-push event failed', event.id, eventError);
        await closeEvent(event.id, 'pending');
      }
    }

    return json({ ok: true, sent, skipped }, 200, corsHeaders);
  } catch (error) {
    console.error('low-stock-push failed', error);
    return json({ ok: false, error: (error as Error).message }, 500, corsHeaders);
  }
});
