-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  account_type TEXT DEFAULT 'household',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'household',
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Inventory items table
CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE POLICY "Users can view own inventory" ON public.inventory_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory" ON public.inventory_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory" ON public.inventory_items
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory" ON public.inventory_items
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_inventory_user_id ON public.inventory_items(user_id);
CREATE INDEX idx_inventory_expiration ON public.inventory_items(expiration_date);
CREATE INDEX idx_inventory_category ON public.inventory_items(category);
CREATE INDEX idx_inventory_barcode ON public.inventory_items(barcode);

-- Inventory consumption table
CREATE TABLE public.inventory_consumption (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC,
  unit TEXT,
  consumed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consumption" ON public.inventory_consumption
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own consumption" ON public.inventory_consumption
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Food waste table
CREATE TABLE public.food_waste (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC,
  unit TEXT,
  reason TEXT,
  estimated_value NUMERIC,
  wasted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.food_waste ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own waste" ON public.food_waste
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own waste" ON public.food_waste
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Recipes table
CREATE TABLE public.recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE POLICY "Anyone can view recipes" ON public.recipes
  FOR SELECT USING (true);

-- Recipe ingredients table
CREATE TABLE public.recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  optional BOOLEAN DEFAULT false
);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view recipe ingredients" ON public.recipe_ingredients
  FOR SELECT USING (true);

-- Favorite recipes table
CREATE TABLE public.favorite_recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.favorite_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own favorites" ON public.favorite_recipes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own favorites" ON public.favorite_recipes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_favorite_unique ON public.favorite_recipes(user_id, recipe_id);

-- Grocery lists table
CREATE TABLE public.grocery_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.grocery_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own grocery lists" ON public.grocery_lists
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own grocery lists" ON public.grocery_lists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own grocery lists" ON public.grocery_lists
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own grocery lists" ON public.grocery_lists
  FOR DELETE USING (auth.uid() = user_id);

-- Grocery items table
CREATE TABLE public.grocery_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE POLICY "Users can view own grocery items" ON public.grocery_items
  FOR SELECT USING (auth.uid() = grocery_list_id IN (SELECT id FROM grocery_lists WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own grocery items" ON public.grocery_items
  FOR INSERT WITH CHECK (grocery_list_id IN (SELECT id FROM grocery_lists WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own grocery items" ON public.grocery_items
  FOR UPDATE USING (grocery_list_id IN (SELECT id FROM grocery_lists WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own grocery items" ON public.grocery_items
  FOR DELETE USING (grocery_list_id IN (SELECT id FROM grocery_lists WHERE user_id = auth.uid()));

-- Notification preferences table
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  days_before INTEGER DEFAULT 3,
  recipe_notifications BOOLEAN DEFAULT true,
  grocery_notifications BOOLEAN DEFAULT false,
  weekly_summary BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification prefs" ON public.notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notification prefs" ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_notification_prefs_unique ON public.notification_preferences(user_id);

-- Notification logs table
CREATE TABLE public.notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id),
  notification_type TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification logs" ON public.notification_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification logs" ON public.notification_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User preferences table
CREATE TABLE public.user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  weight_unit TEXT DEFAULT 'g',
  volume_unit TEXT DEFAULT 'ml',
  currency TEXT DEFAULT 'PHP',
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_preferences_unique ON public.user_preferences(user_id);

-- Database functions
CREATE OR REPLACE FUNCTION public.get_expiring_items(user_id UUID, days INTEGER)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  quantity NUMERIC,
  unit TEXT,
  expiration_date DATE,
  category TEXT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT ii.id, ii.product_name, ii.quantity, ii.unit, ii.expiration_date, ii.category, ii.status
  FROM inventory_items ii
  WHERE ii.user_id = user_id
    AND ii.expiration_date IS NOT NULL
    AND ii.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + days
    AND ii.status != 'consumed'
    AND ii.status != 'wasted'
  ORDER BY ii.expiration_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.calculate_food_waste(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(estimated_value) FROM food_waste WHERE user_id = user_id AND wasted_at BETWEEN start_date AND end_date),
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.calculate_food_consumption(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(ii.price * ic.quantity)
     FROM inventory_consumption ic
     JOIN inventory_items ii ON ii.id = ic.inventory_item_id
     WHERE ic.user_id = user_id AND ic.consumed_at BETWEEN start_date AND end_date),
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.calculate_estimated_savings(user_id UUID, start_date DATE, end_date DATE)
RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(public.calculate_food_consumption(user_id, start_date, end_date));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_recipe_matches(user_id UUID, category TEXT DEFAULT NULL, limit_count INTEGER DEFAULT 10)
RETURNS SETOF recipes AS $$
BEGIN
  RETURN QUERY
  SELECT r.* FROM recipes r
  WHERE category IS NULL OR r.category = category
  ORDER BY r.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars', 'avatars', false),
  ('inventory-images', 'inventory-images', false),
  ('recipe-images', 'recipe-images', true);

-- Storage policies
CREATE POLICY "Users can upload own avatars" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own avatars" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own avatars" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can upload own inventory images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'inventory-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own inventory images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'inventory-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Seed recipe data
INSERT INTO recipes (id, name, description, image_url, category, difficulty, prep_time, servings, instructions, created_at) VALUES
  ('1', 'Creamy Chicken Pasta', 'A delicious pasta with chicken and cream sauce', NULL, 'meals', 'easy', 20, 4, '["Boil pasta", "Cook chicken", "Prepare sauce", "Combine ingredients", "Serve"]', NOW()),
  ('2', 'Vegetable Stir Fry', 'Fresh vegetables stir-fried to perfection', NULL, 'meals', 'easy', 15, 2, '["Cut vegetables", "Heat wok", "Stir fry vegetables", "Season and serve"]', NOW()),
  ('3', 'Banana Pancakes', 'Fluffy pancakes made with ripe bananas', NULL, 'desserts', 'easy', 15, 4, '["Mash bananas", "Mix batter", "Cook pancakes", "Serve with syrup"]', NOW()),
  ('4', 'Chicken Curry', 'Aromatic chicken curry with spices', NULL, 'meals', 'medium', 45, 4, '["Sauté spices", "Add chicken", "Add coconut milk", "Simmer and serve"]', NOW()),
  ('5', 'Garlic Butter Shrimp', 'Succulent shrimp in garlic butter sauce', NULL, 'seafood', 'easy', 15, 2, '["Melt butter", "Add garlic", "Cook shrimp", "Season and serve"]', NOW()),
  ('6', 'Vegetable Soup', 'Hearty vegetable soup with fresh ingredients', NULL, 'meals', 'easy', 30, 4,
  ["Chop vegetables", "Boil broth", "Add vegetables", "Simmer", "Season and serve"]', NOW()),
  ('7', 'Beef Stir Fry', 'Flavorful beef with crisp vegetables', NULL, 'meals', 'medium', 20, 2, '["Slice beef", "Stir fry beef", "Add vegetables", "Season and serve"]', NOW()),
  ('8', 'Egg Fried Rice', 'Classic fried rice with eggs', NULL, 'meals', 'easy', 15, 2,
  ["Cook rice", "Scramble eggs", "Stir fry everything", "Season and serve"]', NOW()),
  ('9', 'Chicken Sandwich', 'Grilled chicken sandwich with fresh greens', NULL, 'meals', 'easy', 10, 1,
  ["Grill chicken", "Prepare bread", "Add greens and sauce", "Serve"]', NOW()),
  ('10', 'Pasta Primavera', 'Pasta with spring vegetables', NULL, 'meals', 'easy', 20, 2,
  ["Boil pasta", "Sauté vegetables", "Combine and season", "Serve"]', NOW()),
  ('11', 'Berry Smoothie Bowl', 'Refreshing smoothie bowl with berries', NULL, 'desserts', 'easy', 10, 1,
  ["Blend berries", "Pour into bowl", "Add toppings", "Serve"]', NOW()),
  ('12', 'Chocolate Lava Cake', 'Rich chocolate cake with molten center', NULL, 'desserts', 'medium', 30, 2,
  ["Melt chocolate", "Mix batter", "Bake", "Serve warm"]', NOW()),
  ('13', 'Greek Yogurt Parfait', 'Layered yogurt with fruits and granola', NULL, 'desserts', 'easy', 10, 1,
  ["Layer yogurt", "Add fruits", "Top with granola", "Serve"]', NOW()),
  ('14', 'Grilled Salmon', 'Herb-grilled salmon fillet', NULL, 'seafood', 'medium', 25, 2,
  ["Season salmon", "Grill fillet", "Serve with lemon"]', NOW()),
  ('15', 'Caesar Salad', 'Classic Caesar salad with crispy croutons', NULL, 'meals', 'easy', 10, 2,
  ["Toss lettuce", "Add dressing", "Top with croutons", "Serve"]', NOW()),
  ('16', 'Fruit Salad', 'Fresh seasonal fruit salad', NULL, 'desserts', 'easy', 10, 2,
  ["Chop fruits", "Mix together", "Drizzle honey", "Serve"]', NOW()),
  ('17', 'Chicken Tacos', 'Spicy chicken tacos with fresh toppings', NULL, 'meals', 'medium', 25, 3,
  ["Cook chicken", "Prepare tortillas", "Add toppings", "Serve"]', NOW()),
  ('18', 'Caprese Pasta Salad', 'Cold pasta salad with tomatoes and mozzarella', NULL, 'meals', 'easy', 15, 3,
  ["Cook pasta", "Mix with vegetables", "Add cheese", "Dress and serve"]', NOW()),
  ('19', 'Stuffed Bell Peppers', 'Bell peppers stuffed with rice and meat', NULL, 'meals', 'medium', 40, 2,
  ["Hollow peppers", "Stuff with mixture", "Bake", "Serve"]', NOW()),
  ('20', 'Fruit Smoothie', 'Quick and refreshing fruit smoothie', NULL, 'beverages', 'easy', 5, 1,
  ["Blend fruits", "Add milk", "Serve chilled"]', NOW());

INSERT INTO recipe_ingredients (recipe_id, ingredient_name, quantity, unit, optional) VALUES
  (1, 'chicken breast', 200, 'g', false),
  (1, 'pasta', 200, 'g', false),
  (1, 'milk', 1, 'cup', false),
  (1, 'cream', 0.5, 'cup', false),
  (1, 'garlic', 1, 'clove', false),
  (2, 'broccoli', 150, 'g', false),
  (2, 'carrots', 100, 'g', false),
  (2, 'soy sauce', 2, 'tbsp', false),
  (3, 'bananas', 2, 'pcs', false),
  (3, 'flour', 100, 'g', false),
  (4, 'chicken', 500, 'g', false),
  (4, 'coconut milk', 1, 'can', false);

-- Indexes for performance
CREATE INDEX idx_recipes_category ON recipes(category);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);