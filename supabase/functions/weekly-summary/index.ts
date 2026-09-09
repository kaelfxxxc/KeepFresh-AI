// weekly-summary
// Aggregates the last 7 days for a user: food consumed (with peso value), food
// wasted, money estimated saved, and what is currently about to expire. Meant
// to feed a weekly push/email summary ("You saved PHP 824 this week").
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/weekly-summary \
//     -H "Authorization: Bearer <user access token>"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { json, handleOptions } from '../_shared/cors.ts';

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const userId = await userIdFromRequest(req);
    if (!userId) return json({ ok: false, error: 'Missing or invalid access token' }, 401);

    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const week = (col: string) =>
      supabaseAdmin
        .from(col)
        .select('*, inventory_items(product_name, price)')
        .eq('user_id', userId)
        .gte('consumed_at', since);

    const [consumedRes, wasteRes, invRes] = await Promise.all([
      supabaseAdmin.from('inventory_consumption')
        .select('quantity, consumed_at, inventory_items(price)')
        .eq('user_id', userId).gte('consumed_at', since),
      supabaseAdmin.from('food_waste')
        .select('reason, estimated_value, wasted_at, inventory_items(product_name)')
        .eq('user_id', userId).gte('wasted_at', since),
      supabaseAdmin.from('inventory_items')
        .select('product_name, expiration_date')
        .eq('user_id', userId)
        .not('expiration_date', 'is', null)
        .not('status', 'in', '("consumed","wasted")')
        .lte('expiration_date', 'now()::date + interval \'3 days\''),
    ]);

    const consumed = consumedRes.data ?? [];
    const wasted = wasteRes.data ?? [];
    const expiring = invRes.data ?? [];

    const consumedValue = consumed.reduce(
      (sum, c) => sum + Number(c.inventory_items?.price ?? 0) * Number(c.quantity ?? 1),
      0
    );
    const wastedValue = wasted.reduce(
      (sum, w) => sum + Number(w.estimated_value ?? 0),
      0
    );

    const summary = {
      ok: true,
      user_id: userId,
      period: { days: 7, since },
      food_used: { count: consumed.length, value: Math.round(consumedValue) },
      food_wasted: { count: wasted.length, value: Math.round(wastedValue) },
      estimated_saved: Math.round(consumedValue), // money not re-bought because you used it
      expiring_soon: expiring.map((e) => ({
        name: e.product_name,
        expires_on: e.expiration_date,
      })),
      message: `You kept ${Math.round(consumedValue)} worth of food out of the bin this week.`,
    };

    return json(summary);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
