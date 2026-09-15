// barcodeService — talks to the barcode-lookup edge function (which keeps the
// Barcode Lookup API key server-side) and maps its payload onto the shapes the
// app's screens expect. Pure helpers live here so the scan screens stay thin.

import { supabase } from '../lib/supabase';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';
import { resolveCategory } from '../utils/categoryIcons';

/** Trimmed product as returned by the barcode-lookup edge function. */
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
 * Ask the server to look a barcode up.
 *
 * One AI scan is charged server-side per answered lookup, so `limit_reached`
 * means the plan's monthly allowance is spent. Check `gates.aiScan` before
 * opening the camera to show the upgrade prompt instead of the failure.
 */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  return invokeScanFunction('barcode-lookup', { barcode });
}

/* ---------------------------------------------------------- pure helpers */

/**
 * A provider's category text → a canonical category key.
 *
 * The matching itself lives in `categoryIcons.resolveCategory`, which is the one
 * place in the app that knows the vocabulary. This function only strips the
 * generic market segment Barcode Lookup prepends to every grocery path
 * ("Food, Beverages & Tobacco > Beverages > Soda"), because leaving it in lets
 * the trailing root "Beverages" out-vote a more specific later segment
 * ("… > Dairy > Cheese" must be dairy, not beverages).
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
