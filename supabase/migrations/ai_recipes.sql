ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS user_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Hands-on time and time on the heat, kept apart because a 10-minute prep
  -- with a 40-minute simmer is a different commitment from the reverse.
  ADD COLUMN IF NOT EXISTS cook_time     INTEGER,
  -- Share of the non-optional ingredients the user actually had, 0-100.
  ADD COLUMN IF NOT EXISTS match_percent INTEGER,
  -- The short dish phrase the image search was run with, kept so a future
  -- re-search asks the same question rather than inventing a new one.
  ADD COLUMN IF NOT EXISTS image_query   TEXT,
  -- 'catalog' = the seeded rows. 'ai' = machine-generated for one user.
  ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS generated_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.recipes.user_id IS
  'NULL = shared catalog (seed.sql). Set = generated for that user.';
COMMENT ON COLUMN public.recipes.match_percent IS
  'Percentage of non-optional ingredients present in inventory at generation time.';

-- The Recipes tab's read: this user's recipes, newest generation first.
CREATE INDEX IF NOT EXISTS idx_recipes_user_generated
  ON public.recipes(user_id, generated_at DESC);

-- Re-runnable: drop before adding so a second paste does not collide.
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_source_check;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_source_check CHECK (source IN ('catalog', 'ai'));

ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_match_percent_check;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_match_percent_check
  CHECK (match_percent IS NULL OR match_percent BETWEEN 0 AND 100);

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recipe_ingredients.available IS
  'True when the ingredient was found in the user''s inventory at generation time.';

DROP POLICY IF EXISTS "Anyone can view recipes" ON public.recipes;
DROP POLICY IF EXISTS "Users can view own or catalog recipes" ON public.recipes;
CREATE POLICY "Users can view own or catalog recipes" ON public.recipes
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view recipe ingredients" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "Users can view ingredients of visible recipes" ON public.recipe_ingredients;
CREATE POLICY "Users can view ingredients of visible recipes" ON public.recipe_ingredients
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM public.recipes r
       WHERE r.id = recipe_ingredients.recipe_id
         AND (r.user_id IS NULL OR r.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own favorites" ON public.favorite_recipes;
CREATE POLICY "Users can delete own favorites" ON public.favorite_recipes
  FOR DELETE USING (auth.uid() = user_id);


DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(c, ', ')
    INTO v_missing
    FROM unnest(ARRAY['user_id', 'cook_time', 'match_percent', 'image_query', 'source', 'generated_at']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = c
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'recipes is missing: %', v_missing;
  END IF;
END;
$$;

SELECT 'AI recipe schema ready — set PEXELS_API_KEY and deploy recipe-suggestions' AS status;
