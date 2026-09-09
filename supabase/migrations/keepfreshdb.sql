-- ============================================================================
-- KeepFresh AI - Supabase schema
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
-- It is idempotent (safe to run again). Run supabase/migrations/seed.sql AFTER this.
-- ============================================================================

-- 1. Extensions ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid(), crypt()

-- 2. Profiles -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  account_type TEXT DEFAULT 'household',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 3. Auto-create profile on user signup --------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'account_type', 'household'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Inventory items ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  barcode TEXT,
  quantity NUMERIC DEFAULT 1,
  unit TEXT DEFAULT 'pcs',
  purchase_date DATE,
  expiration_date DATE,
  price NUMERIC,
  image_url TEXT,
  notes TEXT,
  status TEXT DEFAULT 'available',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own inventory" ON public.inventory_items;
CREATE POLICY "Users can view own inventory" ON public.inventory_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own inventory" ON public.inventory_items;
CREATE POLICY "Users can insert own inventory" ON public.inventory_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own inventory" ON public.inventory_items;
CREATE POLICY "Users can update own inventory" ON public.inventory_items
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own inventory" ON public.inventory_items;
CREATE POLICY "Users can delete own inventory" ON public.inventory_items
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON public.inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiration ON public.inventory_items(expiration_date);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON public.inventory_items(barcode);

-- 5. Inventory consumption ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_consumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC,
  unit TEXT,
  consumed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_consumption ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own consumption" ON public.inventory_consumption;
CREATE POLICY "Users can view own consumption" ON public.inventory_consumption
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own consumption" ON public.inventory_consumption;
CREATE POLICY "Users can insert own consumption" ON public.inventory_consumption
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. Food waste ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.food_waste (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC,
  unit TEXT,
  reason TEXT,
  estimated_value NUMERIC,
  wasted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.food_waste ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own waste" ON public.food_waste;
CREATE POLICY "Users can view own waste" ON public.food_waste
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own waste" ON public.food_waste;
CREATE POLICY "Users can insert own waste" ON public.food_waste
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. Recipes ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  category TEXT,
  difficulty TEXT,
  prep_time INTEGER,
  servings INTEGER,
  instructions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view recipes" ON public.recipes;
CREATE POLICY "Anyone can view recipes" ON public.recipes
  FOR SELECT USING (true);

-- 8. Recipe ingredients -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  optional BOOLEAN DEFAULT false
);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view recipe ingredients" ON public.recipe_ingredients;
CREATE POLICY "Anyone can view recipe ingredients" ON public.recipe_ingredients
  FOR SELECT USING (true);

-- 9. Favorite recipes ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.favorite_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.favorite_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own favorites" ON public.favorite_recipes;
CREATE POLICY "Users can view own favorites" ON public.favorite_recipes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own favorites" ON public.favorite_recipes;
CREATE POLICY "Users can insert own favorites" ON public.favorite_recipes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_unique ON public.favorite_recipes(user_id, recipe_id);

-- 10. Grocery lists ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grocery_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.grocery_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own grocery lists" ON public.grocery_lists;
CREATE POLICY "Users can view own grocery lists" ON public.grocery_lists
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own grocery lists" ON public.grocery_lists;
CREATE POLICY "Users can insert own grocery lists" ON public.grocery_lists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own grocery lists" ON public.grocery_lists;
CREATE POLICY "Users can update own grocery lists" ON public.grocery_lists
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own grocery lists" ON public.grocery_lists;
CREATE POLICY "Users can delete own grocery lists" ON public.grocery_lists
  FOR DELETE USING (auth.uid() = user_id);

-- 11. Grocery items -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grocery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grocery_list_id UUID REFERENCES public.grocery_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  quantity NUMERIC DEFAULT 1,
  unit TEXT,
  estimated_price NUMERIC,
  purchased BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.grocery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own grocery items" ON public.grocery_items;
CREATE POLICY "Users can view own grocery items" ON public.grocery_items
  FOR SELECT USING (
    grocery_list_id IN (SELECT gl.id FROM public.grocery_lists gl WHERE gl.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own grocery items" ON public.grocery_items;
CREATE POLICY "Users can insert own grocery items" ON public.grocery_items
  FOR INSERT WITH CHECK (
    grocery_list_id IN (SELECT gl.id FROM public.grocery_lists gl WHERE gl.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own grocery items" ON public.grocery_items;
CREATE POLICY "Users can update own grocery items" ON public.grocery_items
  FOR UPDATE USING (
    grocery_list_id IN (SELECT gl.id FROM public.grocery_lists gl WHERE gl.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own grocery items" ON public.grocery_items;
CREATE POLICY "Users can delete own grocery items" ON public.grocery_items
  FOR DELETE USING (
    grocery_list_id IN (SELECT gl.id FROM public.grocery_lists gl WHERE gl.user_id = auth.uid())
  );

-- 12. Notification preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  days_before INTEGER DEFAULT 3,
  recipe_notifications BOOLEAN DEFAULT true,
  grocery_notifications BOOLEAN DEFAULT false,
  weekly_summary BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification prefs" ON public.notification_preferences;
CREATE POLICY "Users can view own notification prefs" ON public.notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.notification_preferences;
CREATE POLICY "Users can update own notification prefs" ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_prefs_unique ON public.notification_preferences(user_id);

-- 13. Notification logs ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id),
  notification_type TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification logs" ON public.notification_logs;
CREATE POLICY "Users can view own notification logs" ON public.notification_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own notification logs" ON public.notification_logs;
CREATE POLICY "Users can insert own notification logs" ON public.notification_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 14. User preferences --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  weight_unit TEXT DEFAULT 'g',
  volume_unit TEXT DEFAULT 'ml',
  currency TEXT DEFAULT 'PHP',
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences" ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences" ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preferences_unique ON public.user_preferences(user_id);

-- 15. Database functions ------------------------------------------------------------

-- Items expiring within N days from today.
CREATE OR REPLACE FUNCTION public.get_expiring_items(user_id UUID, days INTEGER)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  quantity NUMERIC,
  unit TEXT,
  expiration_date DATE,
  category TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR $1 <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied: user_id does not match the session';
  END IF;
  RETURN QUERY
  SELECT ii.id, ii.product_name, ii.quantity, ii.unit, ii.expiration_date, ii.category, ii.status
  FROM public.inventory_items ii
  WHERE ii.user_id = $1
    AND ii.expiration_date IS NOT NULL
    AND ii.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2
    AND ii.status NOT IN ('consumed', 'wasted')
  ORDER BY ii.expiration_date ASC;
END;
$$;

-- Total value wasted in a date range.
CREATE OR REPLACE FUNCTION public.calculate_food_waste(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR $1 <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied: user_id does not match the session';
  END IF;
  RETURN COALESCE(
    (SELECT SUM(fw.estimated_value)
     FROM public.food_waste fw
     WHERE fw.user_id = $1
       AND fw.wasted_at::date BETWEEN $2 AND $3),
    0
  );
END;
$$;

-- Value of food actually consumed in a date range.
CREATE OR REPLACE FUNCTION public.calculate_food_consumption(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR $1 <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied: user_id does not match the session';
  END IF;
  RETURN COALESCE(
    (SELECT SUM(ii.price * ic.quantity)
     FROM public.inventory_consumption ic
     JOIN public.inventory_items ii ON ii.id = ic.inventory_item_id
     WHERE ic.user_id = $1
       AND ic.consumed_at::date BETWEEN $2 AND $3),
    0
  );
END;
$$;

-- Rough estimate of money saved by eating from the pantry.
CREATE OR REPLACE FUNCTION public.calculate_estimated_savings(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN ROUND(public.calculate_food_consumption($1, $2, $3));
END;
$$;

-- Recipe lookup. The parameter is named "limit" to match the mobile client call:
--   supabase.rpc('get_recipe_matches', { user_id, limit: 10 })
CREATE OR REPLACE FUNCTION public.get_recipe_matches(user_id UUID, category TEXT DEFAULT NULL, "limit" INTEGER DEFAULT 10)
RETURNS SETOF public.recipes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT r.*
  FROM public.recipes r
  WHERE ($2 IS NULL OR r.category = $2)
  ORDER BY r.created_at DESC
  LIMIT $3;
END;
$$;

-- Consume part or all of an inventory item. Inserts a consumption record and,
-- when the whole item is gone, flips its status to 'consumed'. Called by the
-- mobile app:
--   supabase.rpc('consume_inventory_item', { p_user_id, p_item_id, p_quantity })
CREATE OR REPLACE FUNCTION public.consume_inventory_item(
  p_user_id UUID,
  p_item_id UUID,
  p_quantity NUMERIC DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_quantity NUMERIC;
  used NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied: user_id does not match the session';
  END IF;

  SELECT ii.quantity
    INTO cur_quantity
    FROM public.inventory_items ii
   WHERE ii.id = p_item_id AND ii.user_id = p_user_id
   FOR UPDATE;

  IF cur_quantity IS NULL THEN
    RAISE EXCEPTION 'inventory item % not found for user %', p_item_id, p_user_id;
  END IF;

  used := COALESCE(p_quantity, cur_quantity);
  used := LEAST(used, cur_quantity);

  INSERT INTO public.inventory_consumption (user_id, inventory_item_id, quantity, unit, consumed_at)
  SELECT p_user_id, ii.id, used, ii.unit, NOW()
    FROM public.inventory_items ii
   WHERE ii.id = p_item_id;

  IF used >= cur_quantity THEN
    UPDATE public.inventory_items
       SET status = 'consumed', updated_at = NOW()
     WHERE id = p_item_id;
  ELSE
    UPDATE public.inventory_items
       SET quantity = quantity - used, updated_at = NOW()
     WHERE id = p_item_id;
  END IF;
END;
$$;

-- 16. Indexes ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_recipes_category ON public.recipes(category);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);

-- 17. Storage buckets + policies ----------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', false),
  ('inventory-images', 'inventory-images', false),
  ('recipe-images', 'recipe-images', true)
ON CONFLICT (id) DO NOTHING;

-- avatars
DROP POLICY IF EXISTS "Users can upload own avatars" ON storage.objects;
CREATE POLICY "Users can upload own avatars" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can view own avatars" ON storage.objects;
CREATE POLICY "Users can view own avatars" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
CREATE POLICY "Users can delete own avatars" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- inventory-images
DROP POLICY IF EXISTS "Users can upload own inventory images" ON storage.objects;
CREATE POLICY "Users can upload own inventory images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'inventory-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can view own inventory images" ON storage.objects;
CREATE POLICY "Users can view own inventory images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'inventory-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own inventory images" ON storage.objects;
CREATE POLICY "Users can delete own inventory images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'inventory-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- 18. Done --------------------------------------------------------------------------
SELECT 'KeepFresh AI schema ready. Next: run supabase/migrations/seed.sql' AS status;
