// barcode-lookup
// Proxies the Open Food Facts product lookup (world.openfoodfacts.org) so the
// mobile app has one place to meter against. The mobile app calls this with the
// signed-in user's access token (verify_jwt = true) and a { barcode } body.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/barcode-lookup \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"barcode":"3017620422003"}'
//
// It used to proxy Barcode Lookup (api.barcodelookup.com), whose key lived here
// as the BARCODE_SCANNER_API_KEY secret. That plan lapsed and the API is gone;
// Open Food Facts answers the same question over an unauthenticated HTTPS GET,
// so there is no secret to set and the app can — and does — call it directly.
// This function stays deployed, now on Open Food Facts, because builds already
// in the field still call it and because it is the only path that meters.
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

// The fields the app's BarcodeProduct is built from. Without `fields` the API
// returns the whole document — 50 to 200 KB of photos and taxonomies per
// product, which the app never reads.
const OFF_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'ingredients_text',
  'categories',
  'image_front_url',
  'image_url',
].join(',');

// Open Food Facts asks every client to identify itself; anonymous traffic from
// shared addresses is what their rate limiter throttles. And this address is
// shared by every caller of this function.
const OFF_USER_AGENT = 'KeepFreshAI/1.0 (https://keepfresh.ai)';

// The subset of the product document this function reads. Kept identical to
// `OffProduct` in src/services/barcodeService.ts — the app renders one shape
// whichever path the lookup came down. `categories_tags` is deliberately absent
// there too: it is normalised English, but it carries broad parent categories
// that mislabel products a keyword matcher reads literally.
interface OffProduct {
  product_name?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  ingredients_text?: string;
  categories?: string;
  image_front_url?: string;
  image_url?: string;
}

// Only trust the answer when the document is the code we asked for. Open Food
// Facts normalises codes it is handed — 12345 comes back as 00012345 — so the
// comparison is numeric, which also lets a 12-digit UPC and its 13-digit EAN-13
// equivalent (leading zero) match.
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
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
        `?fields=${OFF_FIELDS}`,
      {
        headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      },
    );

    // 404 is v2's "no such barcode" — an answer, and one that is metered below.
    // Anything else that is not a 2xx (429 for rate limiting, 5xx, or an outage)
    // is "try later", and is not charged against the user's scans.
    if (res.status !== 404 && !res.ok) {
      console.error(`barcode-lookup: upstream returned ${res.status}`);
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    let product: Record<string, unknown> | null = null;
    if (res.status !== 404) {
      const payload = await res.json() as {
        status?: number;
        code?: string;
        product?: OffProduct;
      };
      const p = payload.status === 1 ? payload.product : undefined;

      // A document with no name at all would open the app's review screen on an
      // empty form, so it counts as nothing found.
      if (p && normalized(payload.code ?? '') === normalized(barcode) && (p.product_name || p.generic_name)) {
        // `generic_name` is a descriptive line, not a second name: it backs the
        // title up when there is no product name, and otherwise becomes the
        // description. Never both — that prints one sentence twice.
        product = {
          barcode: payload.code || barcode,
          title: p.product_name || p.generic_name || null,
          brand: p.brands || null,
          manufacturer: null,
          category: p.categories || null,
          description: p.product_name ? p.generic_name || null : null,
          ingredients: p.ingredients_text || null,
          image_url: p.image_front_url || p.image_url || null,
          size: p.quantity || null,
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
