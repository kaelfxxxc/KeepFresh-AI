// barcodeService — looks a scanned barcode up in Open Food Facts and maps the
// payload onto the shapes the app's screens expect. Pure helpers live here so
// the scan screens stay thin.
//
// The lookup is a plain HTTPS GET the device makes itself. It used to go through
// the `barcode-lookup` edge function, which proxied Barcode Lookup (an API that
// needed a key and a paid plan); Open Food Facts needs neither, so the key, the
// secret and the round trip through our own function are all gone. The function
// is still deployed and still meters, for builds in the field that predate this
// change — it now proxies Open Food Facts too.

import { supabase } from '../lib/supabase';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';
import { resolveCategory } from '../utils/categoryIcons';

/** Trimmed product, in the one shape every scan screen reads. */
export interface BarcodeProduct {
  barcode: string;
  title: string | null;
  brand: string | null;
  manufacturer: string | null;
  category: string | null;
  description: string | null;
  ingredients: string | null;
  image_url: string | null;
  size: string | null;
}

/** The shape the review-preview screen (/scan/product) renders and edits. */
export interface ReviewInfo {
  product_name: string;
  brand: string;
  category: string; // lowercase DB key: 'dairy' | 'produce' | … | 'other'
  expiration_date: string;
  quantity: number;
  unit: string;
  barcode: string;
  image_url?: string;
  description?: string;
  ingredients?: string;
}

export type LookupResult =
  | { status: 'found'; product: BarcodeProduct }
  | { status: 'not_found' }
  | { status: 'unavailable' }
  | { status: 'limit_reached' };

/**
 * The `error` code from a function's JSON body, when the call failed with a
 * non-2xx status. `supabase-js` hands those back as a FunctionsHttpError whose
 * `context` is the raw Response, so the body has to be read back off it.
 */
async function failureCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== 'function') return null;
  try {
    const body = (await context.clone().json()) as { error?: string } | null;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

/**
 * The result of calling an edge function, before anyone has decided what the
 * payload means.
 *
 * `code` is the `error` string from the function's own JSON body — `null` when
 * the call never got that far (not deployed, network down, or an older
 * supabase-js that threw instead of returning).
 */
export type FunctionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: string | null };

/**
 * Shared transport for every edge function the app calls.
 *
 * `barcode-lookup`, `food-vision` and `recipe-suggestions` answer in the same
 * envelope and fail with the same codes, so the call itself lives here once and
 * each caller reads its own payload out of the result. That is what keeps the
 * photo scanner — and now recipe generation — inheriting the barcode scanner's
 * failure handling rather than reimplementing it and drifting.
 *
 * Never throws.
 */
export async function invokeFunction<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<FunctionOutcome<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return { ok: false, code: await failureCode(error) };
    return { ok: true, data: data as T };
  } catch (err) {
    // Older supabase-js threw directly; treat both failure kinds the same.
    if (err instanceof FunctionsHttpError || err instanceof FunctionsFetchError) {
      return { ok: false, code: null };
    }
    console.error(`${fn} error:`, err);
    return { ok: false, code: null };
  }
}

/**
 * A scan, read as the three-state answer the scan screens already branch on.
 *
 * Never throws — degrades to `unavailable` on any failure (including the function
 * not being deployed yet) so callers can fall back to manual entry.
 */
export async function invokeScanFunction(
  fn: string,
  body: Record<string, unknown>,
): Promise<LookupResult> {
  const outcome = await invokeFunction<{
    ok?: boolean;
    found?: boolean;
    product?: BarcodeProduct;
  } | null>(fn, body);

  if (!outcome.ok) {
    return outcome.code === 'ai_scan_limit_reached'
      ? { status: 'limit_reached' }
      : { status: 'unavailable' };
  }

  const d = outcome.data;
  if (d && d.ok && d.found && d.product) return { status: 'found', product: d.product };
  if (d && d.ok) return { status: 'not_found' };
  return { status: 'unavailable' };
}

/**
 * The Open Food Facts fields asked for, as one comma-separated list.
 *
 * The API returns the whole product document when `fields` is omitted — 50 to
 * 200 KB of photos, packaging and per-country taxonomies, none of which the app
 * reads. On a phone on mobile data that is the slowest part of a scan for no
 * gain, so the request names exactly the fields `BarcodeProduct` is built from.
 */
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

/**
 * Open Food Facts asks every client to identify itself by user agent; anonymous
 * traffic from shared addresses is what their rate limiter throttles. Purely
 * cosmetic — the lookup answers without it.
 */
const OFF_USER_AGENT = 'KeepFreshAI/1.0 (https://keepfresh.ai)';

/**
 * The subset of an Open Food Facts product document the app asks for.
 *
 * `categories_tags` is deliberately not among them even though it is the same
 * taxonomy in normalised English, which reads like the better source for a
 * non-English entry. Open Food Facts tags nearly every product with its broad
 * parent categories ("en:fruits-and-vegetables-based-foods"), and a keyword
 * matcher cannot tell a parent from a leaf, so the tags win the match and
 * mislabel the product — worse than the plain-language `categories` below.
 */
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

/**
 * Look a barcode up in Open Food Facts.
 *
 * No API key and no server in the middle: `world.openfoodfacts.org` answers
 * unauthenticated GETs over HTTPS. Note that this means the lookup is not
 * metered — see the plan's AI-scan allowance, which `barcode-lookup` charges but
 * this direct call does not. Check `gates.aiScan` before opening the camera.
 */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`,
      { headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' } },
    );

    // v2 answers 404 for a barcode it has never seen. That is an answer, not an
    // outage, and the scan screen has a different thing to say about each.
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };

    const body = (await response.json()) as { status?: number; product?: OffProduct };
    // `status: 0` arrives with a 200 for a malformed code. A document with no
    // name at all is treated the same way: the review screen would open on an
    // empty form, and a saved item with a blank name is worse than being told
    // nothing was found.
    const product = body.status === 1 ? body.product : undefined;
    if (!product || !(product.product_name || product.generic_name)) {
      return { status: 'not_found' };
    }

    // `generic_name` is a descriptive line ("Hazelnut spread with cocoa"), not a
    // second name. It stands in for a missing product name, and otherwise fills
    // the review screen's description block — never both, which would print the
    // same sentence twice on one screen.
    const title = product.product_name || product.generic_name || null;
    const description = product.product_name ? product.generic_name || null : null;

    return {
      status: 'found',
      product: {
        barcode,
        title,
        brand: product.brands || null,
        // Open Food Facts has no manufacturer field, and `brands` is what the
        // review screen falls back to anyway.
        manufacturer: null,
        category: product.categories || null,
        description,
        ingredients: product.ingredients_text || null,
        // The front-of-pack shot, not `image_url` — that one is often a photo of
        // the label's back or the packaging lying on a table.
        image_url: product.image_front_url || product.image_url || null,
        size: product.quantity || null,
      },
    };
  } catch (error) {
    console.error('Open Food Facts lookup error:', error);
    return { status: 'unavailable' };
  }
}

/* ---------------------------------------------------------- pure helpers */

/**
 * A provider's category text → a canonical category key.
 *
 * The matching itself lives in `categoryIcons.resolveCategory`, which is the one
 * place in the app that knows the vocabulary. This function only strips the
 * generic market segment Barcode Lookup prepended to every grocery path
 * ("Food, Beverages & Tobacco > Beverages > Soda"), because leaving it in lets
 * the trailing root "Beverages" out-vote a more specific later segment
 * ("… > Dairy > Cheese" must be dairy, not beverages). Open Food Facts sends a
 * comma-separated list instead and never carries that prefix — the strip is left
 * in place for the rows still stored from the old provider, and because a
 * segment that is not there costs nothing to remove.
 */
export function mapBarcodeCategory(rawPath: string | null | undefined): string {
  const text = (rawPath ?? '')
    .toLowerCase()
    .replace('food, beverages & tobacco', '')
    .replace('food, beverage & tobacco', '')
    .replace('food & beverage', '');
  return resolveCategory(text);
}

// Units the add-inventory screen offers, in priority order: container words
// first (a "24 x 330 ml Can" is a can, not millilitres), then measures.
// Each pattern only fires when the unit is its own token ("g" never matches
// inside "kg", "l" never matches inside "ml").
const UNIT_PATTERNS: Array<{ unit: string; re: RegExp }> = [
  { unit: 'pack', re: /(?:^|[^a-z])pack(?:s)?(?:[^a-z]|$)/i },
  { unit: 'bottle', re: /(?:^|[^a-z])bottles?(?:[^a-z]|$)/i },
  { unit: 'can', re: /(?:^|[^a-z])cans?(?:[^a-z]|$)/i },
  { unit: 'box', re: /(?:^|[^a-z])box(?:es)?(?:[^a-z]|$)/i },
  { unit: 'cups', re: /(?:^|[^a-z])cups?(?:[^a-z]|$)/i },
  { unit: 'ml', re: /(?:^|[^a-z])(?:[\d.,]+\s*)?ml(?:[^a-z]|$)/i },
  { unit: 'L', re: /(?:^|[^a-z])[\d.,]+\s*l(?:[^a-z]|$)/i },
  { unit: 'kg', re: /(?:^|[^a-z])(?:[\d.,]+\s*)?kg(?:[^a-z]|$)/i },
  { unit: 'lb', re: /(?:^|[^a-z])(?:[\d.,]+\s*)?lb(?:[^a-z]|$)/i },
  { unit: 'oz', re: /(?:^|[^a-z])(?:[\d.,]+\s*)?oz(?:[^a-z]|$)/i },
  { unit: 'g', re: /(?:^|[^a-z])[\d.,]+\s*g(?:[^a-z]|$)/i },
];

export function guessUnit(size: string | null | undefined): string {
  const s = (size ?? '').toLowerCase();
  if (!s) return 'pcs';
  for (const { unit, re } of UNIT_PATTERNS) {
    if (re.test(s)) return unit;
  }
  return 'pcs';
}

/** Turn a server product payload into the state the review screen shows. */
export function toReviewProduct(p: BarcodeProduct): ReviewInfo {
  return {
    product_name: p.title || '',
    brand: p.brand || p.manufacturer || '',
    category: mapBarcodeCategory(p.category),
    expiration_date: '',
    quantity: 1,
    unit: guessUnit(p.size),
    barcode: p.barcode,
    image_url: p.image_url || '',
    description: p.description || '',
    ingredients: p.ingredients || '',
  };
}
