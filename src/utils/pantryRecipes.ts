// The Recipes tab's per-product view.
//
// A generation writes two kinds of recipe. A *pantry-wide* set, spread across
// the categories so every chip has something, and a *product* set for each of
// the most urgent few items — five dishes built around that one thing, at least
// three of them Filipino.
//
// Both kinds land under a product. The pantry-wide ones reach it through their
// ingredients (a dessert that names bananas is a banana recipe), the product ones
// through the item they were generated around. This module is where those two
// links are read as one answer, and where the cap and the ordering the user asked
// for are applied.
//
// Kept separate from the screen and free of Supabase, in the spirit of
// wasteTrend.ts, so the rules can be reasoned about — and exercised — on their own.

import type { RecipeWithIngredients } from '../types';

/**
 * The most suggestions a single product will show.
 *
 * This is the user's "5 max suggestion each product". It is a ceiling rather
 * than a target: a product the generation did not cover, or covered thinly,
 * legitimately shows fewer, and padding the list to reach five would mean
 * inventing dishes.
 */
export const PRODUCT_RECIPE_CAP = 5;

/**
 * How many Filipino dishes lead a product's set.
 *
 * The generation is asked for at least this many per product; the display
 * guarantees only their *order*, so a set that came back with four is shown with
 * four. Ordering is the part the client owns, and it is the part that makes the
 * rule visible.
 */
export const FILIPINO_PRIORITY = 3;

/** The cuisine value the app treats specially. */
const FILIPINO = 'filipino';

/**
 * Whether a recipe is a Filipino dish.
 *
 * An exact comparison on a normalised value, never a substring test: "Filipino-
 * style" and "not filipino" both contain the word, and neither is a claim this
 * should be making on a cook's behalf.
 */
export function isFilipino(recipe: Pick<RecipeWithIngredients, 'cuisine'>): boolean {
  return recipe.cuisine?.trim().toLowerCase() === FILIPINO;
}

/**
 * A cuisine tag as a person reads it: `filipino` → `Filipino`, `southeast asian`
 * → `Southeast Asian`.
 *
 * Stored lower-case so the tag is one value rather than as many as there are
 * capitalisations of it, and title-cased only here — display cannot change what
 * the column means, which is what keeps `isFilipino`'s exact comparison honest.
 */
export function cuisineLabel(cuisine: string): string {
  return cuisine
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** One chip in the product row. */
export interface ProductGroup {
  /** The inventory item's id — what `recipesForProduct` takes. */
  id: string;
  name: string;
  /** The item's photo, a bucket path or a remote URL, for `ItemImage`. */
  imageUrl: string | null;
  category: string | null;
  /** How many recipes this product has, before the display cap. */
  count: number;
}

/** The minimum a caller has to hand over about an inventory item. */
export interface PantryItem {
  id: string;
  product_name: string;
  category: string | null;
  image_url: string | null;
}

/**
 * The product chips: every pantry item that has at least one recipe, most-used
 * first.
 *
 * Ordered by count rather than by name or by the pantry's own order, because the
 * row exists to answer "what can I cook with what I have" — and the products with
 * the most to offer are the ones worth tapping. Ties fall back to the name, so
 * the row does not reshuffle between two renders of the same data.
 *
 * An item with no recipes is left out entirely: a chip that opens onto an empty
 * list is worse than no chip.
 */
export function productGroups(
  items: PantryItem[],
  recipes: Pick<RecipeWithIngredients, 'inventory_item_ids'>[],
): ProductGroup[] {
  const counts = new Map<string, number>();
  recipes.forEach((recipe) => {
    // A recipe that names the same product twice was already de-duplicated on the
    // way in (see `withRollup`), so counting ids directly cannot double-count.
    new Set(recipe.inventory_item_ids).forEach((id) => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
  });

  return items
    .map((item) => ({
      id: item.id,
      name: item.product_name,
      imageUrl: item.image_url,
      category: item.category,
      count: counts.get(item.id) ?? 0,
    }))
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * One product's suggestions: Filipino first, capped.
 *
 * The Filipino dishes lead because the user asked for them to be shown first,
 * and the cap is applied *after* that ordering so the dishes it drops are the
 * least wanted rather than whichever happened to be written last. Within each
 * group the incoming order is preserved, which is the match-percent ordering the
 * server worked out — so the best match of each kind is the first of its kind.
 */
export function recipesForProduct(
  productId: string,
  recipes: RecipeWithIngredients[],
): RecipeWithIngredients[] {
  const forProduct = recipes.filter((recipe) => recipe.inventory_item_ids.includes(productId));

  const filipino = forProduct.filter(isFilipino);
  const other = forProduct.filter((recipe) => !isFilipino(recipe));

  return [...filipino, ...other].slice(0, PRODUCT_RECIPE_CAP);
}

/** How many Filipino dishes a product's set leads with, for the chip's caption. */
export function filipinoCount(recipes: RecipeWithIngredients[]): number {
  return Math.min(recipes.filter(isFilipino).length, FILIPINO_PRIORITY);
}
