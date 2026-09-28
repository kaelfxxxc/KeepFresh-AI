// recipeService — the Recipes tab's data layer.
//
// Two things here are new. `generateRecipes` asks the recipe-suggestions edge
// function to write a fresh set of dishes from the user's current inventory, and
// every read is scoped to a single user, because a recipe is now something
// generated for a person rather than a row in a shared catalog.
//
// The AI is never on the render path. Generation is a deliberate, metered act
// that ends in Postgres; the screens only ever read Postgres. That is also what
// caches the photographs — the Pexels URL is stored on the row, so a dish is
// searched once, not on every visit.

import { supabase } from '../lib/supabase';
import { invokeFunction } from './barcodeService';
import { groceryService } from './groceryService';
import { resolveCategory } from '../utils/categoryIcons';
import type { Recipe, RecipeIngredient, RecipeWithIngredients } from '../types';

/**
 * A recipe row as PostgREST returns it, with its ingredients nested. Naming the
 * relation here is what lets one request answer "what is this recipe and what
 * does it need".
 */
type RecipeRow = Recipe & { recipe_ingredients?: RecipeIngredient[] | null };

/** Shared select: the recipe, plus exactly the ingredient fields the UI reads. */
const RECIPE_COLUMNS =
  '*, recipe_ingredients(id, recipe_id, ingredient_name, quantity, unit, optional, available, inventory_item_id)';

/**
 * The detail screen's select: the shared columns, plus the name of the product
 * the recipe was generated around.
 *
 * `primary_inventory_item_id` is enough to *link* a recipe to an item but not to
 * name it, and the detail screen's one useful sentence about it — "built around
 * your chicken" — needs the name. Embedding it here answers that in the same
 * request rather than a second round trip.
 *
 * The `!primary_inventory_item_id` hint names the foreign key column, which is
 * how PostgREST picks between two tables it could otherwise join on more than
 * one path. Only the detail screen pays for it, so the list query is unchanged.
 */
const RECIPE_DETAIL_COLUMNS = `${RECIPE_COLUMNS}, primary_item:inventory_items!primary_inventory_item_id(product_name)`;

/**
 * Roll the nested ingredients into the summary counts a card renders, and drop
 * the relation so the result is a plain recipe.
 *
 * The card shows "5 of 7 ingredients" without a query per row, and the counts
 * come from the same rows the detail screen splits on — so a card and the screen
 * it opens can never disagree about coverage.
 *
 * `inventory_item_ids` is gathered here for the same reason: the product chips
 * need "which pantry items is this dish for", and the answer is already in the
 * rows this function is walking. De-duplicated, because a recipe can name the
 * same product twice ("chicken thigh" and "chicken stock" both match one item).
 */
function withRollup(row: RecipeRow): RecipeWithIngredients {
  const ingredients = row.recipe_ingredients ?? [];
  const { recipe_ingredients: _nested, ...recipe } = row;

  const itemIds = new Set<string>();
  if (row.primary_inventory_item_id) itemIds.add(row.primary_inventory_item_id);
  ingredients.forEach((i) => { if (i.inventory_item_id) itemIds.add(i.inventory_item_id); });

  return {
    ...recipe,
    ingredient_names: ingredients.map((i) => i.ingredient_name),
    available_count: ingredients.filter((i) => i.available).length,
    total_count: ingredients.length,
    inventory_item_ids: [...itemIds],
  };
}

/** What a generation attempt did, in the terms the screen reacts to. */
export type GenerateResult =
  | { status: 'ok'; generated: number }
  /** The model looked at the pantry and found nothing worth cooking in it. */
  | { status: 'nothing_to_cook' }
  /** The plan's monthly AI allowance is spent — show the upgrade, not an error. */
  | { status: 'limit_reached' }
  | { status: 'unavailable' };

/** The outcome of pushing ingredients onto the grocery list. */
export interface GroceryAddResult {
  /** Names this call put on the list. */
  added: string[];
  /** Names already there — re-tapping is a no-op, not a duplicate row. */
  already_listed: string[];
}

/** Everything the detail screen renders, in one answer. */
export interface RecipeDetail {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  /**
   * The product this recipe was built around, when it came from a per-product
   * set. NULL for the pantry-wide recipes, which are not "for" any single item.
   */
  primaryItemName: string | null;
}

export const recipeService = {
  /**
   * This user's recipes, best match first.
   *
   * The `user_id` filter is the whole "no seeded recipes" guarantee: catalog rows
   * have a NULL owner, so they cannot appear here even though RLS still lets them
   * be read. Ordering by `match_percent` puts the dishes that use the most of what
   * the user already owns at the top, which is the point of generating from a
   * pantry in the first place.
   *
   * Category filtering is left to the caller — a generation is at most eight rows,
   * and the chips on the tab filter them in memory rather than refetching.
   */
  async getRecipes(userId: string): Promise<RecipeWithIngredients[]> {
    const { data, error } = await supabase
      .from('recipes')
      .select(RECIPE_COLUMNS)
      .eq('user_id', userId)
      .order('match_percent', { ascending: false, nullsFirst: false })
      .order('generated_at', { ascending: false });
    if (error) throw error;
    return ((data as RecipeRow[] | null) ?? []).map(withRollup);
  },

  /**
   * One recipe and everything it needs, for the detail screen.
   *
   * `maybeSingle` rather than `single` because "no such recipe" is an ordinary
   * answer here — an id from a stale link, or one RLS has hidden because it
   * belongs to someone else — and it should render as a not-found screen rather
   * than throw.
   *
   * Ingredients come back in the order the generation wrote them, which is
   * roughly the order the dish needs them. The screen re-sorts into available and
   * missing; nothing depends on the original order surviving that.
   */
  async getRecipeDetail(id: string): Promise<RecipeDetail | null> {
    const { data, error } = await supabase
      .from('recipes')
      .select(RECIPE_DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    // The client is untyped and reads an embedded to-one relation as a bare
    // object, which is a shape it cannot infer — hence the cast, as in
    // `getFavorites`.
    const {
      recipe_ingredients: ingredients,
      primary_item: primaryItem,
      ...recipe
    } = data as unknown as RecipeRow & { primary_item: { product_name: string } | null };

    return {
      recipe: recipe as Recipe,
      ingredients: ingredients ?? [],
      primaryItemName: primaryItem?.product_name ?? null,
    };
  },

  /**
   * Ask the server to write a new set of recipes from the current inventory.
   *
   * Spends one AI scan on success — the whole generation, however many model
   * calls it took to write. The server does the spending, after the model has
   * answered — so a refusal, an empty pantry, or an outage costs the user
   * nothing, and `limit_reached` is the only outcome that means they were
   * charged and refused.
   *
   * Passing `category` narrows the request to a single chip and the server
   * answers with one call. Leaving it out is what makes the generation cover
   * products: the server also writes a set around each of the most urgent few,
   * which is what the product chips on the tab read. That is several model calls
   * and takes noticeably longer, which is why the screen's confirmation says so
   * rather than letting the spinner be the only warning.
   *
   * The caller re-reads the list afterwards rather than rendering a response:
   * there is one shape for a recipe in this app, and it is the row.
   */
  async generateRecipes(
    options: { category?: string; count?: number } = {},
  ): Promise<GenerateResult> {
    const outcome = await invokeFunction<{ ok?: boolean; generated?: number } | null>(
      'recipe-suggestions',
      { category: options.category, count: options.count },
    );

    if (!outcome.ok) {
      return outcome.code === 'ai_scan_limit_reached'
        ? { status: 'limit_reached' }
        : { status: 'unavailable' };
    }

    const generated = outcome.data?.generated ?? 0;
    return generated > 0 ? { status: 'ok', generated } : { status: 'nothing_to_cook' };
  },

  /** Remove the current AI suggestions while keeping recipes the user saved. */
  async clearAISuggestions(userId: string): Promise<void> {
    const { data: favourites, error: favouriteError } = await supabase
      .from('favorite_recipes')
      .select('recipe_id')
      .eq('user_id', userId);
    if (favouriteError) throw favouriteError;

    const keep = (favourites ?? []).map((row: { recipe_id: string }) => row.recipe_id);
    let query = supabase
      .from('recipes')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'ai');

    if (keep.length > 0) {
      query = query.not('id', 'in', `(${keep.map((id) => `"${id}"`).join(',')})`);
    }

    const { error } = await query;
    if (error) throw error;
  },

  /** Whether the heart on this recipe is filled. */
  async isFavorite(userId: string, recipeId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('favorite_recipes')
      .select('id')
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  /**
   * Add or remove the heart, returning the state it ended in.
   *
   * The read is `maybeSingle` because "not favourited yet" is the ordinary case
   * rather than an error. The delete only started working when ai_recipes.sql
   * added the DELETE policy this table had been missing.
   */
  async toggleFavorite(userId: string, recipeId: string): Promise<boolean> {
    const { data: existing, error: readError } = await supabase
      .from('favorite_recipes')
      .select('id')
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
      .maybeSingle();
    if (readError) throw readError;

    if (existing) {
      const { error } = await supabase.from('favorite_recipes').delete().eq('id', existing.id);
      if (error) throw error;
      return false;
    }

    const { error } = await supabase
      .from('favorite_recipes')
      .insert({ user_id: userId, recipe_id: recipeId });
    if (error) throw error;
    return true;
  },

  async getFavorites(userId: string): Promise<RecipeWithIngredients[]> {
    const { data, error } = await supabase
      .from('favorite_recipes')
      .select(`recipe:recipes(${RECIPE_COLUMNS})`)
      .eq('user_id', userId);
    if (error) throw error;

    // The client is deliberately untyped, so it reads an embedded relation as an
    // array. `favorite_recipes.recipe_id` is a foreign key to `recipes.id`, which
    // PostgREST resolves as to-one and returns as a bare object — hence the cast
    // through `unknown`, which is the only way to assert a shape the client
    // cannot infer.
    const rows = (data ?? []) as unknown as { recipe: RecipeRow | null }[];
    return rows
      .map((row) => row.recipe)
      .filter((recipe): recipe is RecipeRow => recipe !== null)
      .map(withRollup);
  },

  /**
   * The names already on the user's current grocery list.
   *
   * Lets the detail screen mark a missing ingredient as "on your list" instead of
   * inviting the same tap again on a second visit. Read through
   * `getCurrentGroceryList` rather than `getGroceryList`, so the marker describes
   * the same list `addIngredientsToGroceryList` would write to — the two must not
   * disagree about which list is "the" list.
   */
  async getGroceryListNames(userId: string): Promise<string[]> {
    const list = await groceryService.getCurrentGroceryList(userId);
    if (!list) return [];
    const { data, error } = await supabase
      .from('grocery_items')
      .select('name')
      .eq('grocery_list_id', list.id);
    if (error) throw error;
    return ((data ?? []) as { name: string }[]).map((row) => row.name);
  },

  /**
   * Put ingredients on the grocery list — the bridge into Need to Buy.
   *
   * Takes the ingredients rather than a recipe id so the same call serves both
   * the per-row "add" buttons and "add all": the screen already has the rows, and
   * it decides which are missing.
   *
   * The call sequence is the one the inventory details screen already proved —
   * current list, create it if there is none, skip names already on it. Matching
   * on the exact name is what makes re-tapping idempotent instead of piling up
   * duplicate rows.
   *
   * This is the grocery half of Need to Buy rather than the `need_to_buy` flag on
   * `inventory_items`: that flag marks a product the user owns and wants more of,
   * and a missing ingredient is by definition one they do not own.
   */
  async addIngredientsToGroceryList(
    userId: string,
    ingredients: RecipeIngredient[],
  ): Promise<GroceryAddResult> {
    const result: GroceryAddResult = { added: [], already_listed: [] };
    if (ingredients.length === 0) return result;

    // A recipe asking for the same thing twice would otherwise slip two rows past
    // the existence check, which only sees what is already on the list.
    const unique = [
      ...new Map(ingredients.map((i) => [i.ingredient_name.trim().toLowerCase(), i])).values(),
    ];

    const list =
      (await groceryService.getCurrentGroceryList(userId)) ??
      (await groceryService.createGroceryList(userId));

    const outcomes = await Promise.all(
      unique.map(async (ingredient) => {
        // The stored row is trimmed; the name handed back is not, so callers can
        // keep using it as a key against the ingredient objects they passed in.
        const stored = ingredient.ingredient_name.trim();
        const existing = await groceryService.findGroceryItemByName(list.id, stored);
        if (existing) return { name: ingredient.ingredient_name, added: false };

        await groceryService.addGroceryItem(list.id, {
          name: stored,
          // The grocery screen picks its icon from the category and a recipe
          // ingredient arrives without one, so it is read off the name — the same
          // resolution the barcode lookup uses.
          category: resolveCategory(stored),
          quantity: ingredient.quantity ?? 1,
          unit: ingredient.unit,
          estimated_price: null,
          purchased: false,
        });
        return { name: ingredient.ingredient_name, added: true };
      }),
    );

    for (const outcome of outcomes) {
      if (outcome.added) result.added.push(outcome.name);
      else result.already_listed.push(outcome.name);
    }
    return result;
  },
};
