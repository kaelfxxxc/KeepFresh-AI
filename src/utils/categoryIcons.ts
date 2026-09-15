// Semantic iconography for food categories.
//
// This module is the single source of truth for what a category is called, how a
// stored category maps onto a canonical key, and which icon represents it. It
// exists because the app previously defined its category list in three places
// that disagreed with each other:
//
//   * the add-inventory screen saved `form.category.toLowerCase()`
//   * the barcode service produced lowercase keys of its own
//   * the seed data used Title Case with a different vocabulary entirely
//     ('Meat & Poultry', 'Pantry', 'Bakery', 'Eggs', 'Herbs')
//
// The icon resolver used to switch on lowercase strings, so none of the seeded
// rows matched and every one of them rendered the same generic box. Normalizing
// the stored values is only half the fix — `resolveCategory` below also keeps
// working for free text from a barcode provider, from a vision model, or from a
// row saved before the values were normalized, so the same bug cannot come back
// the next time a new source of category text is introduced.
import type React from 'react';
import type { LucideProps } from 'lucide-react-native';
import {
  Apple,
  Beef,
  Carrot,
  Cookie,
  CupSoda,
  Fish,
  Milk,
  Package,
  Snowflake,
  Utensils,
  Wheat,
} from 'lucide-react-native';

type IconComp = React.ComponentType<LucideProps>;

/**
 * The canonical category keys, in the order they are offered to the user.
 *
 * Every one is a lowercase single word so that the stored value, the key here,
 * and the value a lookup returns are all directly comparable.
 */
export const CATEGORY_KEYS = [
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
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** What each key is called on screen. */
export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat',
  seafood: 'Seafood',
  grains: 'Grains',
  frozen: 'Frozen',
  beverages: 'Beverages',
  snacks: 'Snacks',
  condiments: 'Condiments',
  canned: 'Canned & Packaged',
  other: 'Other',
};

/**
 * One icon per category, chosen to be recognisable at thumbnail size.
 *
 * All are stroked outlines from the app's existing icon library, so they sit
 * consistently beside the icons used for storage areas and navigation — the
 * emoji this replaces could not match stroke weight or colour at all.
 */
const CATEGORY_ICONS: Record<CategoryKey, IconComp> = {
  produce: Apple,
  dairy: Milk,
  meat: Beef,
  seafood: Fish,
  grains: Wheat,
  frozen: Snowflake,
  beverages: CupSoda,
  snacks: Cookie,
  condiments: Utensils,
  canned: Package,
  other: Package,
};

/** Fallback tile for an item with no category at all. */
export const DEFAULT_CATEGORY: CategoryKey = 'other';

/** Case-insensitive, whitespace-insensitive lookup against the canonical keys. */
const CANONICAL = new Set<string>(CATEGORY_KEYS);

/**
 * Spellings that appear in data but are not canonical keys.
 *
 * 'Pantry' maps to `canned` rather than `grains` because the seeded pantry rows
 * are overwhelmingly tins, jars and bottles (canned tuna, sardines, bouillon
 * cubes, cooking oil); the one bag of rice is the exception, and a wrong icon on
 * a single row is worth not splitting `pantry` into two.
 */
const LEGACY_ALIASES: Record<string, CategoryKey> = {
  eggs: 'dairy',
  'meat & poultry': 'meat',
  'meat and poultry': 'meat',
  pantry: 'canned',
  bakery: 'grains',
  herbs: 'condiments',
  spices: 'condiments',
  'canned/packaged': 'canned',
  'canned & packaged': 'canned',
  packaged: 'canned',
  canned: 'canned',
  fruits: 'produce',
  fruit: 'produce',
  vegetables: 'produce',
  vegetable: 'produce',
  veggies: 'produce',
  drinks: 'beverages',
  dairy_eggs: 'dairy',
};

/**
 * Last-resort substrings, for category text no alias covers — a provider's
 * breadcrumb ("Food > Dairy > Cheese"), a vision model's free-text answer, or a
 * category a user typed by hand.
 *
 * Order is load-bearing and deliberately specific-first: 'ice cream' has to be
 * tested before the dairy rule, or every tub of ice cream matches 'cream'.
 */
const KEYWORD_RULES: Array<{ re: RegExp; key: CategoryKey }> = [
  { re: /ice\s*cream|frozen|froze/, key: 'frozen' },
  { re: /seafood|shellfish|\bfish\b|shrimp|prawn|salmon|tuna|crab|lobster|squid|clam|oyster/, key: 'seafood' },
  { re: /poultry|\bmeat\b|\bbeef\b|\bpork\b|chicken|turkey|\blamb\b|\bham\b|bacon|sausage|steak|drumstick/, key: 'meat' },
  { re: /dairy|\bmilk\b|cheese|yogurt|yoghurt|butter|cream|\begg(s)?\b|margarine/, key: 'dairy' },
  { re: /produce|vegetable|veggie|\bfruit|herb|salad|lettuce|tomato|onion|potato|carrot/, key: 'produce' },
  { re: /grain|\brice\b|pasta|noodle|cereal|\boat|flour|bread|bakery|tortilla|wheat|granola|baking/, key: 'grains' },
  { re: /beverage|\bdrink|soda|juice|\bwater\b|coffee|\btea\b|cola|smoothie|beer|wine|liquor|espresso/, key: 'beverages' },
  { re: /snack|\bchip|cookie|biscuit|candy|chocolate|cracker|popcorn|confection|\bnut/, key: 'snacks' },
  { re: /condiment|sauce|dressing|ketchup|mayonnaise|mustard|spread|\bjam\b|honey|vinegar|pickle|syrup|\bsalt\b|spice|seasoning/, key: 'condiments' },
  { re: /canned|\bcan\b|packaged|pantry|\bjar\b|\btin\b|instant/, key: 'canned' },
];

/**
 * Any stored or computed category string → a canonical key.
 *
 * Never throws and never returns null: an unrecognised value becomes 'other', so
 * a caller always has something to render.
 */
export function resolveCategory(raw?: string | null): CategoryKey {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return DEFAULT_CATEGORY;
  if (CANONICAL.has(text)) return text as CategoryKey;

  const alias = LEGACY_ALIASES[text];
  if (alias) return alias;

  for (const { re, key } of KEYWORD_RULES) {
    if (re.test(text)) return key;
  }
  return DEFAULT_CATEGORY;
}

/** The icon for a category, from any spelling of it. */
export function categoryIcon(raw?: string | null): IconComp {
  return CATEGORY_ICONS[resolveCategory(raw)];
}

/** The display label for a category, from any spelling of it. */
export function categoryLabel(raw?: string | null): string {
  return CATEGORY_LABELS[resolveCategory(raw)];
}

/** Whether a value is already a canonical key, i.e. needs no normalizing. */
export function isCanonicalCategory(raw?: string | null): boolean {
  return CANONICAL.has((raw ?? '').trim().toLowerCase());
}
