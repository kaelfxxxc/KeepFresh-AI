// food-vision
// Identifies a food item from a photo the user took or picked from their gallery.
//
// This is the second half of the scanner: barcode-lookup answers "what is this
// barcode", food-vision answers "what is this thing". Everything around it is
// deliberately identical to barcode-lookup, because the app treats the two as one
// workflow — same response envelope, same one-scan metering, same failure codes —
// so the client has a single result shape and a single set of fallbacks.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/food-vision \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"image_base64":"<base64>","media_type":"image/jpeg"}'
//
// Returns { ok: true, found: true, product: {...} } for a recognised food,
// { ok: true, found: false } for a photo with no food in it (or one the model
// cannot identify), and { ok: false, error } for misconfiguration or upstream
// failures.
//
// One AI scan is metered per answered request, against the plan the caller's JWT
// belongs to — the same `consume_ai_scan` counter barcode scans draw on, so a
// photo costs the user exactly what a barcode does. Charges are taken only for a
// definitive answer; a timeout or an Anthropic outage costs the user nothing.
//
// The client never supplies a user id, a prompt, or a model name. It sends an
// image and gets back the same fields a barcode lookup would have produced.
//
// Requires the ANTHROPIC_API_KEY secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy food-vision

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { json, handleOptions } from '../_shared/cors.ts';

/**
 * Sonnet rather than Opus: identifying a single plated or packaged item is a
 * bounded recognition task, and this runs inside a scan the user is waiting on.
 */
const MODEL = 'claude-sonnet-5';

/**
 * Anthropic accepts 10 MB of base64 per image. Stop short of that so the JSON
 * envelope and headers cannot push the request over, and so an oversized photo is
 * rejected here — clearly and without spending an API call — rather than upstream
 * with an opaque error. The app downsizes before sending, so only a hand-rolled
 * request should ever reach this.
 */
const MAX_BASE64_CHARS = 8_000_000;

const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Below this, the model is guessing — a blurry shelf, a half-eaten plate — and a
 * confident-looking wrong name in the review form is worse than the manual-entry
 * form the user would otherwise get. Same failure path, honest outcome.
 */
const MIN_CONFIDENCE = 0.3;

/**
 * The category vocabulary, spelled out for the model so its answer is a key the
 * app already knows. Deliberately the same list as src/utils/categoryIcons.ts.
 */
const CATEGORY_KEYS = [
  'produce',
  'dairy',
  'meat',
  'seafood',
  'grains',
  'frozen',
  'beverages',
  'snacks',
  'condiments',
  'canned',
  'other',
];

const SYSTEM_PROMPT = `You identify food items from photographs for a grocery and pantry app.

Reply with a single JSON object and nothing else — no prose, no markdown, no code fences.

{
  "is_food": boolean,
  "confidence": number,
  "name": string,
  "brand": string,
  "category": string,
  "description": string,
  "size": string,
  "ingredients": string
}

Rules:
- "is_food": false if the photo does not show a food or drink item (a person, a pet, furniture, a landscape, a screenshot). When false, set every other field to an empty string and "confidence" to 0.
- "confidence": 0 to 1, how sure you are of the identification overall.
- "name": the specific item, in the form a shopper would write on a list — "Whole Milk", "Ribeye Steak", "Roma Tomatoes", "Cheddar Cheese". Not a category, not a sentence.
- "brand": the brand if it is visible on the packaging. Empty string if unbranded or not visible — never guess a brand.
- "category": exactly one of ${CATEGORY_KEYS.join(', ')}. Pick the aisle the item is sold in, not its ingredients: ice cream is "frozen" even though it is dairy, and tinned soup is "canned" even though it is savoury.
- "description": one short factual sentence. Do not speculate about nutrition, freshness, or whether the item is safe to eat.
- "size": the net weight or volume if it is legible on the packaging, as written ("500 g", "1 L", "12 fl oz"). Empty string if not visible — never guess.
- "ingredients": the ingredient list, only if it is actually legible in the photo. Empty string otherwise. Never invent or complete one.
- Only describe what you can see. If you cannot tell what the item is, set "confidence" low and say so plainly in "description".`;

/** The fields we ask the model for, before they are mapped onto the envelope. */
interface VisionResult {
  is_food: boolean;
  confidence: number;
  name: string;
  brand: string;
  category: string;
  description: string;
  size: string;
  ingredients: string;
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
    console.error('food-vision: missing SUPABASE_URL / SUPABASE_ANON_KEY / Authorization');
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

    console.error(`food-vision: consume_ai_scan returned ${res.status}: ${body}`);
    return 'error';
  } catch (err) {
    console.error('food-vision: consume_ai_scan request failed', err);
    return 'error';
  }
}

/** Coerce whatever the model produced into the fields we expect, never throwing. */
function coerce(raw: Record<string, unknown>): VisionResult {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
  };
  return {
    is_food: raw.is_food === true,
    confidence: num(raw.confidence),
    name: str(raw.name),
    brand: str(raw.brand),
    category: str(raw.category),
    description: str(raw.description),
    size: str(raw.size),
    ingredients: str(raw.ingredients),
  };
}

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    console.error('food-vision: ANTHROPIC_API_KEY secret not set');
    return json({ ok: false, error: 'lookup_not_configured' }, 500);
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let imageBase64 = '';
  let mediaType = '';
  try {
    const body = await req.json();
    imageBase64 = String(body?.image_base64 ?? '');
    mediaType = String(body?.media_type ?? '').toLowerCase();
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }

  if (!imageBase64) {
    return json({ ok: false, error: 'invalid_image' }, 400);
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return json({ ok: false, error: 'image_too_large' }, 413);
  }
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return json({ ok: false, error: 'unsupported_media_type' }, 415);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        // The image goes before the text: Claude reads a request better when the
        // picture is already in context by the time the question arrives.
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: 'Identify the food item in this photo.' },
            ],
          },
          // Prefilling the opening brace is what keeps the reply to bare JSON:
          // the model continues the object instead of introducing it.
          { role: 'assistant', content: '{' },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    // 401 (bad key), 429 (rate limit), 5xx — all "try later", and none of them
    // are charged against the user's scans. The upstream body is never forwarded.
    if (!res.ok) {
      const detail = await res.text();
      console.error(`food-vision: upstream returned ${res.status}: ${detail.slice(0, 500)}`);
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    const payload = await res.json();
    const text = Array.isArray(payload?.content)
      ? payload.content
          .filter((b: { type?: string }) => b?.type === 'text')
          .map((b: { text?: string }) => b.text ?? '')
          .join('')
      : '';

    if (!text.trim()) {
      // A refusal or an empty completion is not an answer — do not charge for it.
      console.error('food-vision: upstream returned no text content', payload?.stop_reason);
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    // The prefill consumed the opening brace, so put it back before parsing.
    // Fences are stripped defensively in case the prefill was not honoured.
    const cleaned = `{${text}`
      .replace(/^```(?:json)?/i, '')
      .replace(/```\s*$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      console.error(`food-vision: could not find a JSON object in the reply: ${cleaned.slice(0, 500)}`);
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    let parsed: VisionResult;
    try {
      parsed = coerce(JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>);
    } catch (err) {
      console.error('food-vision: reply was not valid JSON', err, cleaned.slice(0, 500));
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    // The model gave a definitive answer — either "here is the item" or "there is
    // no food here" — so this scan is charged to the caller's plan.
    const meter = await consumeAIScan(req);
    if (meter === 'limit') {
      return json({ ok: false, error: 'ai_scan_limit_reached' }, 429);
    }
    if (meter === 'error') {
      return json({ ok: false, error: 'lookup_unavailable' }, 502);
    }

    if (!parsed.is_food || !parsed.name || parsed.confidence < MIN_CONFIDENCE) {
      return json({ ok: true, found: false });
    }

    // The same envelope barcode-lookup returns, so the client maps both through
    // one path. `category` stays free text here and the app resolves it to an
    // icon key with the same resolver it uses everywhere else.
    return json({
      ok: true,
      found: true,
      product: {
        // A photo has no barcode. The review screen treats an empty one as
        // "not scanned", and the row is saved without one.
        barcode: '',
        title: parsed.name,
        brand: parsed.brand || null,
        manufacturer: null,
        category: parsed.category || null,
        description: parsed.description || null,
        ingredients: parsed.ingredients || null,
        // The client substitutes the local photo URI so the review screen shows
        // the picture that was actually taken.
        image_url: null,
        size: parsed.size || null,
      },
    });
  } catch (err) {
    console.error('food-vision: upstream fetch failed', err);
    return json({ ok: false, error: 'lookup_unavailable' }, 502);
  }
});
