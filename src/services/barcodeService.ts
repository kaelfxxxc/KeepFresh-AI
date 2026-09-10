// barcodeService — talks to the barcode-lookup edge function (which keeps the
// Barcode Lookup API key server-side) and maps its payload onto the shapes the
// app's screens expect. Pure helpers live here so the scan screens stay thin.

import { supabase } from '../lib/supabase';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';

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
  | { status: 'unavailable' };

/**
 * Ask the server to look a barcode up. Never throws — degrades to
 * `unavailable` on any failure (including the function not being deployed yet)
 * so callers can fall back to manual entry.
 */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  try {
    const { data, error } = await supabase.functions.invoke('barcode-lookup', {
      body: { barcode },
    });
    if (error) return { status: 'unavailable' };
    const d = data as { ok?: boolean; found?: boolean; product?: BarcodeProduct } | null;
    if (d && d.ok && d.found && d.product) return { status: 'found', product: d.product };
    if (d && d.ok) return { status: 'not_found' };
    return { status: 'unavailable' };
  } catch (err) {
    // Older supabase-js threw directly; treat both failure kinds the same.
    if (err instanceof FunctionsHttpError || err instanceof FunctionsFetchError) {
      return { status: 'unavailable' };
    }
    console.error('lookupBarcode error:', err);
    return { status: 'unavailable' };
  }
}

/* ---------------------------------------------------------- pure helpers */

// DB category keys (lowercase), each with substrings that commonly appear in
// Barcode Lookup's breadcrumb-style category text (e.g. "Food, Beverages &
// Tobacco > Beverages > Soda"). Longer keywords win so "popcorn" hits snacks,
// not grains' "corn".
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  produce: ['produce', 'fruit', 'vegetable', 'veggie', 'herb', 'salad', 'lettuce', 'onion', 'tomato'],
  dairy: ['dairy', 'milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'egg', 'margarine'],
  meat: ['meat', 'beef', 'pork', 'chicken', 'poultry', 'turkey', 'lamb', 'ham', 'bacon', 'sausage', 'deli', 'steak', 'hot dog'],
  seafood: ['seafood', 'fish', 'shrimp', 'prawn', 'salmon', 'tuna', 'crab', 'lobster', 'squid', 'clam', 'oyster', 'tilapia'],
  grains: ['grain', 'rice', 'pasta', 'noodle', 'cereal', 'oat', 'flour', 'bread', 'bakery', 'tortilla', 'wheat', 'granola'],
  frozen: ['frozen', 'ice cream'],
  beverages: ['beverage', 'drink', 'soda', 'juice', 'water', 'coffee', 'tea', 'cola', 'energy drink', 'beer', 'wine', 'liquor', 'smoothie', 'espresso'],
  snacks: ['snack', 'chip', 'cookie', 'biscuit', 'candy', 'chocolate', 'cracker', 'popcorn', 'confectionery', 'nut'],
  condiments: ['condiment', 'sauce', 'dressing', 'ketchup', 'mayonnaise', 'mustard', 'spread', 'jam', 'honey', 'vinegar', 'pickle', 'syrup', 'salt', 'spice', 'seasoning'],
};

export function mapBarcodeCategory(rawPath: string | null | undefined): string {
  // Barcode Lookup prepends a generic market segment to every grocery path
  // ("Food, Beverages & Tobacco > Beverages > Soda"); drop it so the trailing
  // "Beverages" in that root can't out-vote a more specific later segment
  // ("… > Dairy > Cheese" should be dairy, not beverages).
  const text = (rawPath ?? '')
    .toLowerCase()
    .replace('food, beverages & tobacco', '')
    .replace('food, beverage & tobacco', '')
    .replace('food & beverage', '');
  if (!text.trim()) return 'other';
  let best: string | null = null;
  let bestLen = 0;
  for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (kw.length > bestLen && text.includes(kw)) {
        best = key;
        bestLen = kw.length;
      }
    }
  }
  return best ?? 'other';
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
