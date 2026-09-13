// barcode-lookup
// Proxies the Barcode Lookup (api.barcodelookup.com) product search so the API
// key never ships in the app bundle. The mobile app calls this with the signed-in
// user's access token (verify_jwt = true) and a { barcode } body; the key lives
// server-side as the Supabase secret BARCODE_SCANNER_API_KEY.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/barcode-lookup \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"barcode":"049000042566"}'
//
// Returns { ok: true, found: false } for a barcode the database has never seen,
// { ok: true, found: true, product: {...} } for a match, and
// { ok: false, error } for misconfiguration/upstream failures (the upstream body
// is never forwarded to the client).
//
// One AI scan is metered per answered lookup, for the plan the caller's token
// belongs to. The counter lives in Postgres (`consume_ai_scan`) and is charged
// with the caller's own JWT, so the limit is enforced here and not merely
// displayed in the app — a modified client cannot scan past its allowance.
//
// Charges are only taken for a definitive answer from upstream (a match, or a
// barcode upstream has never seen). An upstream outage costs the user nothing.
// 429 { error: 'ai_scan_limit_reached' } means the monthly allowance is spent.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { json, handleOptions } from '../_shared/cors.ts';

// Upstream answers 404 (empty body) for unregistered codes, but a 200 always
// carries a "products" array whose rows can be dirty (it has mismatched rows,
// e.g. a lipstick for barcode 000000000000). Only trust a row whose returned
// barcode actually matches the one we asked for, comparing numeric values so a
// 12-digit UPC and its 13-digit EAN-13 equivalent (leading zero) still match.
function normalized(code: string): string {
  return String(code).replace(/\s+/g, '').replace(/^0+/, '');
}

/**
 * Charge one AI scan to the caller's plan.
 *
 * `p_user_id` is left null so the RPC meters whichever user the forwarded JWT
 * belongs to — this function never accepts a user id from the client.
 *
 * Fails closed: if the meter cannot be reached we answer `lookup_unavailable`
 * (which the app already degrades to manual entry) rather than hand out a scan
 * the plan may not cover.
 */
async function consumeAIScan(req: Request): Promise<'ok' | 'limit' | 'error'> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const auth = req.headers.get('Authorization');
  if (!url || !anonKey || !auth) {
    console.error('barcode-lookup: missing SUPABASE_URL / SUPABASE_ANON_KEY / Authorization');
    return 'error';
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/consume_ai_scan`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: null }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) return 'ok';

    // The RPC raises 'ai_scan_limit_reached' as its only deliberate refusal.
    const body = await res.text();
    if (body.includes('ai_scan_limit_reached')) return 'limit';

    console.error(`barcode-lookup: consume_ai_scan returned ${res.status}: ${body}`);
    return 'error';
  } catch (err) {
    console.error('barcode-lookup: consume_ai_scan request failed', err);
    return 'error';
  }
}

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const key = Deno.env.get('BARCODE_SCANNER_API_KEY');
  if (!key) {
    console.error('barcode-lookup: BARCODE_SCANNER_API_KEY secret not set');
    return json({ ok: false, error: 'lookup_not_configured' }, 500);
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let barcode = '';
  try {
    const body = await req.json();
    barcode = String(body?.barcode ?? '').trim();
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }
  if (!/^\d{6,14}$/.test(barcode)) {
    return json({ ok: false, error: 'invalid_barcode' }, 400);
  }

  try {
    const url =
      'https://api.barcodelookup.com/v3/products' +
      `?barcode=${encodeURIComponent(barcode)}` +
      `&formatted=y&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    // Anything other than a match or an upstream 404 is "try later", and is not
    // charged against the user's scans.
    if (res.status !== 404 && !res.ok) {
      // 401/403 (bad key), 429 (quota), 5xx — all "try later", not "not found".
      console.error(`barcode-lookup: upstream returned ${res.status}`);
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    let product: Record<string, unknown> | null = null;
    if (res.status !== 404) {
      const payload = await res.json();
      const p = Array.isArray(payload.products) ? payload.products[0] : undefined;
      if (p && normalized(p.barcode_number ?? '') === normalized(barcode)) {
        product = {
          barcode: p.barcode_number || barcode,
          title: p.title || null,
          brand: p.brand || null,
          manufacturer: p.manufacturer || null,
          category: p.category || null,
          description: p.description || null,
          ingredients: p.ingredients || null,
          image_url: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
          size: p.size || null,
        };
      }
    }

    // Upstream gave a definitive answer — a match, or a barcode it has never
    // seen — so this lookup is charged to the caller's plan.
    const meter = await consumeAIScan(req);
    if (meter === 'limit') {
      return json({ ok: false, error: 'ai_scan_limit_reached' }, 429);
    }
    if (meter === 'error') {
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    return product
      ? json({ ok: true, found: true, product })
      : json({ ok: true, found: false });
  } catch (err) {
    console.error('barcode-lookup: upstream fetch failed', err);
    return json({ ok: false, error: 'lookup_unavailable' }, 502);
  }
});
