-- Per-product recipe suggestions.
--
--   recipes.primary_inventory_item_id
--     The product a set was generated *around*. Set only by the per-product
--     calls, which know the answer by construction — no matching is involved.
--
--   recipe_ingredients.inventory_item_id
--     The inventory row an ingredient resolved to at generation time, taken from
--     the matching pass the function already runs to decide `available`.
--
-- The Recipes tab unions the two, so a dessert that names bananas appears under
-- "Bananas" via its ingredient, while a chicken set is attributed exactly.
--
-- ON DELETE SET NULL on both. Consuming or deleting an item must never delete a
-- recipe the user might have favourited; the link simply goes quiet, which is
-- the honest outcome — the dish is no longer "for" something they still have.
--
-- Invariant: recipe_ingredients.inventory_item_id IS NOT NULL implies
-- `available = true`, since one matching pass writes both against the same
-- threshold. The converse does not hold, in two cases — `available` is also set
-- by a whole-string fallback for names made entirely of words the tokenizer
-- drops ("Cooking Oil"), where there is no single row to point at; and by a name
-- whose words are spread across several rows ("chicken" and "thighs" as two
-- items), which matches the pantry without matching any one thing in it.
--
-- APPLY BY HAND: paste this whole file into the Supabase SQL editor.
-- Idempotent — re-running is a no-op.

ALTER TABLE public.recipes
  -- NULL, or a short lower-case word. 'filipino' is the only value the app treats
  -- specially, but the column is free text so a dish is not forced into a bucket
  -- it does not belong to just because the UI only knows one.
  ADD COLUMN IF NOT EXISTS cuisine TEXT,
  ADD COLUMN IF NOT EXISTS primary_inventory_item_id UUID
    REFERENCES public.inventory_items(id) ON DELETE SET NULL;

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID
    REFERENCES public.inventory_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.recipes.cuisine IS
  'Lower-case cuisine tag written by the model, e.g. filipino. NULL when unrecognised.';
COMMENT ON COLUMN public.recipes.primary_inventory_item_id IS
  'The inventory item this recipe was generated around. NULL for pantry-wide recipes.';
COMMENT ON COLUMN public.recipe_ingredients.inventory_item_id IS
  'Inventory row this ingredient matched at generation time. NULL when nothing matched.';

CREATE INDEX IF NOT EXISTS idx_recipes_user_primary_item
  ON public.recipes(user_id, primary_inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_item
  ON public.recipe_ingredients(inventory_item_id);

-- Re-runnable: drop before adding so a second paste does not collide.
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_cuisine_check;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_cuisine_check
  CHECK (cuisine IS NULL OR cuisine ~ '^[a-z][a-z -]{1,30}$');

DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(c, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'recipes.cuisine',
      'recipes.primary_inventory_item_id',
      'recipe_ingredients.inventory_item_id'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name  = split_part(c, '.', 1)
        AND column_name = split_part(c, '.', 2)
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'per-product recipe columns are missing: %', v_missing;
  END IF;
END;
$$;

SELECT 'Per-product recipe links ready — redeploy recipe-suggestions' AS status;
