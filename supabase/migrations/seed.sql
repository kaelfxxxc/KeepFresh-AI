
BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Clean slate for the demo user + seed recipes (makes the file re-runnable)
-- ----------------------------------------------------------------------------
DELETE FROM public.grocery_items
  WHERE grocery_list_id IN (SELECT id FROM public.grocery_lists WHERE user_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM public.grocery_lists WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.inventory_consumption WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.food_waste WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.notification_logs WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.favorite_recipes WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.inventory_items WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.notification_preferences WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM public.user_preferences WHERE user_id = '11111111-1111-4111-8111-111111111111';

DELETE FROM public.favorite_recipes WHERE recipe_id::text LIKE 'c0ffee00-0000-4000-8000-%';
DELETE FROM public.recipe_ingredients WHERE recipe_id::text LIKE 'c0ffee00-0000-4000-8000-%';
DELETE FROM public.recipes WHERE id::text LIKE 'c0ffee00-0000-4000-8000-%';

DELETE FROM auth.identities WHERE user_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM auth.users WHERE id = '11111111-1111-4111-8111-111111111111';

-- ----------------------------------------------------------------------------
-- 1. Demo user (real, confirmed, password login works immediately)
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, phone_change,
  is_sso_user, is_anonymous
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'demo@keepfresh.app',
  crypt('KeepFresh123!', gen_salt('bf', 10)),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"The Reyes Household","account_type":"household"}',
  NOW(), NOW(),
  '', '', '', '', '', '', '',
  false, false
);

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"demo@keepfresh.app","email_verified":true}',
  'email', NOW(), NOW(), NOW()
);

-- The handle_new_user trigger already created public.profiles for this user.
-- (This row simply makes the profile name explicit.)
INSERT INTO public.profiles (id, full_name, email, account_type)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'The Reyes Household', 'demo@keepfresh.app', 'household'
)
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, account_type = EXCLUDED.account_type;

-- ----------------------------------------------------------------------------
-- 2. Recipes  (all dates/labels valid; instructions are proper JSON arrays)
-- ----------------------------------------------------------------------------

INSERT INTO public.recipes (id, name, description, category, difficulty, prep_time, servings, instructions, created_at) VALUES
('c0ffee00-0000-4000-8000-000000000001', 'Classic Chicken Adobo',
 'Tender chicken simmered in soy sauce, vinegar and garlic - the Filipino comfort food staple.',
 'meals', 'easy', 45, 4,
 '["In a bowl, combine the chicken, soy sauce, crushed garlic, peppercorns and bay leaves. Marinate for 30 minutes.","Heat oil in a wide pot over medium heat and brown the chicken on all sides.","Pour in the marinade plus 1 cup of water and bring to a boil.","Lower the heat, cover, and simmer for 30 minutes until the chicken is tender.","Add the vinegar without stirring, simmer uncovered for 10 more minutes, then season and serve over rice."]',
 NOW() - INTERVAL '40 days'),

('c0ffee00-0000-4000-8000-000000000002', 'Sinigang na Bangus',
 'A sour and savory milkfish soup with kangkong and tomatoes - bright, tangy and hearty.',
 'meals', 'medium', 55, 4,
 '["Rub the milkfish with a little salt and set aside.","In a pot, boil 6 cups of water with the tomatoes, onion and sinigang mix.","Slide in the milkfish gently and simmer for 8 minutes.","Add the kangkong leaves and cook for 2 more minutes.","Season with fish sauce and serve hot with steamed rice."]',
 NOW() - INTERVAL '38 days'),

('c0ffee00-0000-4000-8000-000000000003', 'Garlic Butter Chicken',
 'Pan-seared chicken breasts in a garlicky butter pan sauce, ready in half an hour.',
 'meals', 'easy', 30, 2,
 '["Season the chicken breast with salt and pepper.","Heat 1 tbsp butter in a skillet and sear the chicken 5 minutes per side until golden.","Add the garlic and remaining butter, basting the chicken for 2 minutes.","Rest 5 minutes, slice, and spoon the pan sauce on top."]',
 NOW() - INTERVAL '30 days'),

('c0ffee00-0000-4000-8000-000000000004', 'Tuna & Egg Fried Rice',
 'Day-old rice tossed with canned tuna, scrambled egg and garlic - a fast pantry dinner.',
 'meals', 'easy', 20, 2,
 '["Drain the canned tuna, reserving a little oil.","Scramble the eggs in a hot wok and set aside.","Saute garlic and onion in the tuna oil, then add the rice and break up any clumps.","Fold in the tuna, eggs, soy sauce and pepper.","Fry until slightly crisp and serve hot."]',
 NOW() - INTERVAL '25 days'),

('c0ffee00-0000-4000-8000-000000000005', 'Cheesy Tuna Pasta Bake',
 'Creamy pasta with canned tuna under a golden quickmelt cheese crust.',
 'meals', 'medium', 40, 4,
 '["Boil the pasta until al dente and drain.","Saute onion and garlic, then add the tuna, evaporated milk and a little pasta water to make a sauce.","Toss the pasta with the sauce and half the cheese.","Transfer to a baking dish, top with the remaining cheese, and bake at 190C for 15 minutes until bubbly."]',
 NOW() - INTERVAL '20 days'),

('c0ffee00-0000-4000-8000-000000000006', 'Vegetable & Cheese Omelette',
 'A fluffy folded omelette loaded with tomatoes, onion and quickmelt cheese.',
 'meals', 'easy', 15, 1,
 '["Whisk the eggs with a pinch of salt.","Saute the onion and tomato in butter until soft.","Pour in the eggs and cook until the base sets.","Scatter the cheese on one half, fold, and cook 1 more minute."]',
 NOW() - INTERVAL '18 days'),

('c0ffee00-0000-4000-8000-000000000007', 'Pork Giniling',
 'Savory ground pork simmered with tomato, potato and soy sauce - sweet, salty and best over rice.',
 'meals', 'medium', 40, 4,
 '["Brown the ground pork in a pot, breaking it up as it cooks.","Add garlic and onion and saute until fragrant.","Stir in diced potato, tomato sauce, soy sauce and 1/2 cup water.","Simmer for 20 minutes until the potato is tender.","Season with salt and pepper, then serve with steamed rice."]',
 NOW() - INTERVAL '14 days'),

('c0ffee00-0000-4000-8000-000000000008', 'Chicken Arroz Caldo',
 'A ginger-garlic chicken rice porridge that warms you right up.',
 'meals', 'medium', 60, 4,
 '["Saute ginger, garlic and onion in oil until fragrant.","Add the chicken and cook until lightly golden.","Pour in the rice and 6 cups of water; simmer for 30 minutes, stirring often.","Season with fish sauce and top with fried garlic, scallions and calamansi."]',
 NOW() - INTERVAL '10 days'),

('c0ffee00-0000-4000-8000-000000000009', 'Banana Oat Pancakes',
 'Soft pancakes made with ripe banana and oats - no sugar needed.',
 'desserts', 'easy', 25, 4,
 '["Mash the bananas in a bowl.","Whisk in the eggs, oats, milk and a pinch of salt until smooth.","Rest the batter 5 minutes so the oats soften.","Spoon onto a hot greased pan and cook 2 minutes per side.","Serve with extra banana slices and honey."]',
 NOW() - INTERVAL '12 days'),

('c0ffee00-0000-4000-8000-000000000010', 'Mango Banana Smoothie',
 'A creamy two-minute smoothie from mango, banana, yogurt and milk.',
 'beverages', 'easy', 5, 2,
 '["Add the mango, banana, yogurt and milk to a blender.","Blend until completely smooth.","Pour over ice and serve right away."]',
 NOW() - INTERVAL '9 days'),

('c0ffee00-0000-4000-8000-000000000011', 'Mango Yogurt Parfait',
 'Layers of yogurt, ripe mango, banana and toasted oats in a glass.',
 'desserts', 'easy', 10, 2,
 '["Lightly toast the oats in a dry pan for 2 minutes.","Layer yogurt, mango cubes, banana slices and oats in two glasses.","Repeat the layers and finish with a drizzle of honey."]',
 NOW() - INTERVAL '7 days'),

('c0ffee00-0000-4000-8000-000000000012', 'Garlic Parmesan Cheese Toast',
 'Crispy toasted bread slathered with garlic butter and melted cheese.',
 'snacks', 'easy', 10, 2,
 '["Mix softened butter with minced garlic.","Spread onto the bread slices and top with grated cheese.","Toast in a pan or oven until the cheese melts and the edges are crisp."]',
 NOW() - INTERVAL '6 days'),

('c0ffee00-0000-4000-8000-000000000013', 'Cheesy Tuna Quesadilla',
 'A golden tortilla folded around tuna, onion and melted cheese.',
 'snacks', 'easy', 15, 2,
 '["Mix the drained tuna, onion and half the cheese in a bowl.","Spread the filling onto one tortilla and top with the remaining cheese.","Fold, then toast in a dry pan 2 minutes per side.","Slice into wedges and serve with ketchup or hot sauce."]',
 NOW() - INTERVAL '4 days'),

('c0ffee00-0000-4000-8000-000000000014', 'Ginger Honey Calamansi Tea',
 'A soothing hot drink of ginger, calamansi and honey - homemade cold remedy.',
 'beverages', 'easy', 10, 4,
 '["Simmer sliced ginger in 4 cups of water for 8 minutes.","Strain into cups and stir honey into each.","Squeeze calamansi into each cup and stir.","Serve warm."]',
 NOW() - INTERVAL '2 days');

-- ----------------------------------------------------------------------------
-- 3. Recipe ingredients (matched to the demo inventory where possible)
-- ----------------------------------------------------------------------------
INSERT INTO public.recipe_ingredients (id, recipe_id, ingredient_name, quantity, unit, optional) VALUES
-- 01 Chicken Adobo
('c0ffee10-0000-4000-8000-000000000001', 'c0ffee00-0000-4000-8000-000000000001', 'Chicken Breast', 1.0, 'kg', false),
('c0ffee10-0000-4000-8000-000000000002', 'c0ffee00-0000-4000-8000-000000000001', 'Soy Sauce', 0.5, 'cup', false),
('c0ffee10-0000-4000-8000-000000000003', 'c0ffee00-0000-4000-8000-000000000001', 'White Vinegar', 0.25, 'cup', false),
('c0ffee10-0000-4000-8000-000000000004', 'c0ffee00-0000-4000-8000-000000000001', 'Garlic', 6, 'cloves', false),
('c0ffee10-0000-4000-8000-000000000005', 'c0ffee00-0000-4000-8000-000000000001', 'Bay Leaves', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000006', 'c0ffee00-0000-4000-8000-000000000001', 'Black Pepper', 1, 'tsp', true),
-- 02 Sinigang na Bangus
('c0ffee10-0000-4000-8000-000000000007', 'c0ffee00-0000-4000-8000-000000000002', 'Milkfish (Bangus)', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000008', 'c0ffee00-0000-4000-8000-000000000002', 'Kangkong', 1, 'bunch', false),
('c0ffee10-0000-4000-8000-000000000009', 'c0ffee00-0000-4000-8000-000000000002', 'Tomatoes', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000010', 'c0ffee00-0000-4000-8000-000000000002', 'Onion', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000011', 'c0ffee00-0000-4000-8000-000000000002', 'Sinigang Mix', 1, 'pack', false),
-- 03 Garlic Butter Chicken
('c0ffee10-0000-4000-8000-000000000012', 'c0ffee00-0000-4000-8000-000000000003', 'Chicken Breast', 0.5, 'kg', false),
('c0ffee10-0000-4000-8000-000000000013', 'c0ffee00-0000-4000-8000-000000000003', 'Butter', 2, 'tbsp', false),
('c0ffee10-0000-4000-8000-000000000014', 'c0ffee00-0000-4000-8000-000000000003', 'Garlic', 4, 'cloves', false),
-- 04 Tuna & Egg Fried Rice
('c0ffee10-0000-4000-8000-000000000015', 'c0ffee00-0000-4000-8000-000000000004', 'Canned Tuna', 1, 'can', false),
('c0ffee10-0000-4000-8000-000000000016', 'c0ffee00-0000-4000-8000-000000000004', 'Eggs', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000017', 'c0ffee00-0000-4000-8000-000000000004', 'Rice', 2, 'cups', false),
('c0ffee10-0000-4000-8000-000000000018', 'c0ffee00-0000-4000-8000-000000000004', 'Soy Sauce', 1, 'tbsp', false),
('c0ffee10-0000-4000-8000-000000000019', 'c0ffee00-0000-4000-8000-000000000004', 'Garlic', 3, 'cloves', false),
-- 05 Cheesy Tuna Pasta Bake
('c0ffee10-0000-4000-8000-000000000020', 'c0ffee00-0000-4000-8000-000000000005', 'Canned Tuna', 2, 'cans', false),
('c0ffee10-0000-4000-8000-000000000021', 'c0ffee00-0000-4000-8000-000000000005', 'Pasta', 250, 'g', false),
('c0ffee10-0000-4000-8000-000000000022', 'c0ffee00-0000-4000-8000-000000000005', 'Evaporated Milk', 1, 'can', false),
('c0ffee10-0000-4000-8000-000000000023', 'c0ffee00-0000-4000-8000-000000000005', 'Quickmelt Cheese', 160, 'g', false),
-- 06 Vegetable & Cheese Omelette
('c0ffee10-0000-4000-8000-000000000024', 'c0ffee00-0000-4000-8000-000000000006', 'Eggs', 3, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000025', 'c0ffee00-0000-4000-8000-000000000006', 'Tomatoes', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000026', 'c0ffee00-0000-4000-8000-000000000006', 'Onion', 0.5, 'pc', false),
('c0ffee10-0000-4000-8000-000000000027', 'c0ffee00-0000-4000-8000-000000000006', 'Quickmelt Cheese', 40, 'g', false),
-- 07 Pork Giniling
('c0ffee10-0000-4000-8000-000000000028', 'c0ffee00-0000-4000-8000-000000000007', 'Ground Pork', 0.5, 'kg', false),
('c0ffee10-0000-4000-8000-000000000029', 'c0ffee00-0000-4000-8000-000000000007', 'Potatoes', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000030', 'c0ffee00-0000-4000-8000-000000000007', 'Tomato Sauce', 1, 'cup', false),
('c0ffee10-0000-4000-8000-000000000031', 'c0ffee00-0000-4000-8000-000000000007', 'Soy Sauce', 1, 'tbsp', false),
-- 08 Chicken Arroz Caldo
('c0ffee10-0000-4000-8000-000000000032', 'c0ffee00-0000-4000-8000-000000000008', 'Chicken', 0.5, 'kg', false),
('c0ffee10-0000-4000-8000-000000000033', 'c0ffee00-0000-4000-8000-000000000008', 'Rice', 1, 'cup', false),
('c0ffee10-0000-4000-8000-000000000034', 'c0ffee00-0000-4000-8000-000000000008', 'Ginger', 1, 'thumb', false),
('c0ffee10-0000-4000-8000-000000000035', 'c0ffee00-0000-4000-8000-000000000008', 'Garlic', 4, 'cloves', false),
('c0ffee10-0000-4000-8000-000000000036', 'c0ffee00-0000-4000-8000-000000000008', 'Fish Sauce', 1, 'tbsp', true),
-- 09 Banana Oat Pancakes
('c0ffee10-0000-4000-8000-000000000037', 'c0ffee00-0000-4000-8000-000000000009', 'Bananas', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000038', 'c0ffee00-0000-4000-8000-000000000009', 'Eggs', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000039', 'c0ffee00-0000-4000-8000-000000000009', 'Oats', 1, 'cup', false),
('c0ffee10-0000-4000-8000-000000000040', 'c0ffee00-0000-4000-8000-000000000009', 'Fresh Milk', 0.5, 'cup', false),
-- 10 Mango Banana Smoothie
('c0ffee10-0000-4000-8000-000000000041', 'c0ffee00-0000-4000-8000-000000000010', 'Mangoes', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000042', 'c0ffee00-0000-4000-8000-000000000010', 'Bananas', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000043', 'c0ffee00-0000-4000-8000-000000000010', 'Yogurt', 0.5, 'cup', false),
('c0ffee10-0000-4000-8000-000000000044', 'c0ffee00-0000-4000-8000-000000000010', 'Fresh Milk', 0.5, 'cup', false),
-- 11 Mango Yogurt Parfait
('c0ffee10-0000-4000-8000-000000000045', 'c0ffee00-0000-4000-8000-000000000011', 'Yogurt', 1, 'cup', false),
('c0ffee10-0000-4000-8000-000000000046', 'c0ffee00-0000-4000-8000-000000000011', 'Mangoes', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000047', 'c0ffee00-0000-4000-8000-000000000011', 'Bananas', 1, 'pc', false),
('c0ffee10-0000-4000-8000-000000000048', 'c0ffee00-0000-4000-8000-000000000011', 'Oats', 0.5, 'cup', false),
-- 12 Garlic Parmesan Cheese Toast
('c0ffee10-0000-4000-8000-000000000049', 'c0ffee00-0000-4000-8000-000000000012', 'Bread', 2, 'slices', false),
('c0ffee10-0000-4000-8000-000000000050', 'c0ffee00-0000-4000-8000-000000000012', 'Butter', 1, 'tbsp', false),
('c0ffee10-0000-4000-8000-000000000051', 'c0ffee00-0000-4000-8000-000000000012', 'Garlic', 2, 'cloves', false),
('c0ffee10-0000-4000-8000-000000000052', 'c0ffee00-0000-4000-8000-000000000012', 'Quickmelt Cheese', 30, 'g', false),
-- 13 Cheesy Tuna Quesadilla
('c0ffee10-0000-4000-8000-000000000053', 'c0ffee00-0000-4000-8000-000000000013', 'Canned Tuna', 1, 'can', false),
('c0ffee10-0000-4000-8000-000000000054', 'c0ffee00-0000-4000-8000-000000000013', 'Tortilla', 2, 'pcs', false),
('c0ffee10-0000-4000-8000-000000000055', 'c0ffee00-0000-4000-8000-000000000013', 'Quickmelt Cheese', 60, 'g', false),
('c0ffee10-0000-4000-8000-000000000056', 'c0ffee00-0000-4000-8000-000000000013', 'Onion', 0.25, 'pc', false),
-- 14 Ginger Honey Calamansi Tea
('c0ffee10-0000-4000-8000-000000000057', 'c0ffee00-0000-4000-8000-000000000014', 'Ginger', 1, 'thumb', false),
('c0ffee10-0000-4000-8000-000000000058', 'c0ffee00-0000-4000-8000-000000000014', 'Honey', 4, 'tbsp', false),
('c0ffee10-0000-4000-8000-000000000059', 'c0ffee00-0000-4000-8000-000000000014', 'Calamansi', 4, 'pcs', false);

-- ----------------------------------------------------------------------------
-- 4. Demo inventory  (dates are CURRENT_DATE-relative so statuses stay fresh)
--    status: available / consumed / wasted / expired
-- ----------------------------------------------------------------------------
INSERT INTO public.inventory_items
  (id, user_id, product_name, brand, category, quantity, unit, purchase_date, expiration_date, price, notes, status, created_at)
VALUES
-- Available, expiring within the next few days (feed the Alerts screen + RPC)
('c0ffee20-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Fresh Milk 1L', 'Magnolia', 'Dairy', 2, 'L',
 CURRENT_DATE - 4, CURRENT_DATE + 2, 118.00, 'For shakes and morning coffee', 'available', NOW() - INTERVAL '4 days'),
('c0ffee20-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Eggs (Large)', 'Local Farm', 'Eggs', 6, 'pcs',
 CURRENT_DATE - 6, CURRENT_DATE + 6, 10.00, 'Keep refrigerated', 'available', NOW() - INTERVAL '6 days'),
('c0ffee20-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Chicken Breast (Boneless)', 'Magnolia', 'Meat & Poultry', 1.2, 'kg',
 CURRENT_DATE - 1, CURRENT_DATE + 3, 240.00, 'Portion and freeze the rest', 'available', NOW() - INTERVAL '1 day'),
('c0ffee20-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Pork Belly (Liempo)', 'Monterey', 'Meat & Poultry', 1.0, 'kg',
 CURRENT_DATE - 2, CURRENT_DATE + 5, 330.00, NULL, 'available', NOW() - INTERVAL '2 days'),
('c0ffee20-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tomatoes', 'Wet Market', 'Produce', 6, 'pcs',
 CURRENT_DATE - 3, CURRENT_DATE + 4, 3.50, NULL, 'available', NOW() - INTERVAL '3 days'),
('c0ffee20-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Red Onions', 'Wet Market', 'Produce', 1, 'kg',
 CURRENT_DATE - 3, CURRENT_DATE + 45, 120.00, 'Store in a cool dry place', 'available', NOW() - INTERVAL '3 days'),
('c0ffee20-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Garlic', 'Wet Market', 'Produce', 0.25, 'kg',
 CURRENT_DATE - 5, CURRENT_DATE + 60, 160.00, NULL, 'available', NOW() - INTERVAL '5 days'),
('c0ffee20-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Kangkong (Water Spinach)', 'Wet Market', 'Produce', 1, 'bunch',
 CURRENT_DATE - 2, CURRENT_DATE + 1, 25.00, 'Use for sinigang tonight', 'available', NOW() - INTERVAL '2 days'),
('c0ffee20-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'Lakatan Bananas', 'Wet Market', 'Produce', 6, 'pcs',
 CURRENT_DATE - 2, CURRENT_DATE + 3, 10.00, NULL, 'available', NOW() - INTERVAL '2 days'),
('c0ffee20-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'Milkfish (Bangus, whole)', 'Wet Market', 'Seafood', 1, 'pc',
 CURRENT_DATE - 1, CURRENT_DATE + 1, 135.00, 'Cook today - very fresh', 'available', NOW() - INTERVAL '1 day'),
-- Available, long shelf life
('c0ffee20-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'Evaporated Milk 370ml', 'Alaska', 'Dairy', 2, 'can',
 CURRENT_DATE - 10, CURRENT_DATE + 150, 32.00, NULL, 'available', NOW() - INTERVAL '10 days'),
('c0ffee20-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'Tuna Flakes in Oil 155g', 'Century', 'Pantry', 3, 'can',
 CURRENT_DATE - 12, CURRENT_DATE + 120, 32.00, 'Backup lunch option', 'available', NOW() - INTERVAL '12 days'),
('c0ffee20-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'Sinandomeng Rice 5kg', 'Doña Maria', 'Pantry', 5, 'kg',
 CURRENT_DATE - 15, CURRENT_DATE + 365, 52.00, NULL, 'available', NOW() - INTERVAL '15 days'),
('c0ffee20-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', 'Sunflower Cooking Oil 1L', 'Sunny', 'Pantry', 1, 'L',
 CURRENT_DATE - 8, CURRENT_DATE + 180, 115.00, NULL, 'available', NOW() - INTERVAL '8 days'),
('c0ffee20-0000-4000-8000-000000000015', '11111111-1111-4111-8111-111111111111', 'Quickmelt Cheese 160g', 'Eden', 'Dairy', 2, 'block',
 CURRENT_DATE - 14, CURRENT_DATE + 90, 76.00, NULL, 'available', NOW() - INTERVAL '14 days'),
('c0ffee20-0000-4000-8000-000000000016', '11111111-1111-4111-8111-111111111111', 'Plain Yogurt 400g', 'Nestle', 'Dairy', 1, 'tub',
 CURRENT_DATE - 2, CURRENT_DATE + 5, 135.00, NULL, 'available', NOW() - INTERVAL '2 days'),
-- Consumed (feeds consumption analytics)
('c0ffee20-0000-4000-8000-000000000017', '11111111-1111-4111-8111-111111111111', 'Ground Pork 500g', 'Monterey', 'Meat & Poultry', 0.5, 'kg',
 CURRENT_DATE - 12, CURRENT_DATE - 6, 300.00, NULL, 'consumed', NOW() - INTERVAL '12 days'),
('c0ffee20-0000-4000-8000-000000000018', '11111111-1111-4111-8111-111111111111', 'Cabbage', 'Wet Market', 'Produce', 1, 'head',
 CURRENT_DATE - 9, CURRENT_DATE - 4, 65.00, NULL, 'consumed', NOW() - INTERVAL '9 days'),
('c0ffee20-0000-4000-8000-000000000019', '11111111-1111-4111-8111-111111111111', 'Indian Mangoes', 'Wet Market', 'Produce', 3, 'pcs',
 CURRENT_DATE - 6, CURRENT_DATE - 3, 45.00, NULL, 'consumed', NOW() - INTERVAL '6 days'),
-- Wasted (feeds waste analytics + savings)
('c0ffee20-0000-4000-8000-000000000020', '11111111-1111-4111-8111-111111111111', 'Iceberg Lettuce', 'Local', 'Produce', 1, 'head',
 CURRENT_DATE - 10, CURRENT_DATE - 5, 75.00, NULL, 'wasted', NOW() - INTERVAL '10 days'),
('c0ffee20-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'Cream Cheese 250g', 'Philadelphia', 'Dairy', 1, 'tub',
 CURRENT_DATE - 12, CURRENT_DATE - 7, 130.00, NULL, 'wasted', NOW() - INTERVAL '12 days'),
-- Expired but not yet logged as waste (an honest open alert)
('c0ffee20-0000-4000-8000-000000000022', '11111111-1111-4111-8111-111111111111', 'Sliced Wheat Bread', 'Gardenia', 'Bakery', 1, 'loaf',
 CURRENT_DATE - 5, CURRENT_DATE - 1, 90.00, 'Missed the window - check the bread drawer first', 'expired', NOW() - INTERVAL '5 days');

-- ----------------------------------------------------------------------------
-- 5. Consumption records (each links to an item marked 'consumed')
-- ----------------------------------------------------------------------------
INSERT INTO public.inventory_consumption (id, user_id, inventory_item_id, quantity, unit, consumed_at) VALUES
('c0ffee30-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000017', 0.5, 'kg', NOW() - INTERVAL '8 days'),
('c0ffee30-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000018', 1.0, 'head', NOW() - INTERVAL '5 days'),
('c0ffee30-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000019', 3.0, 'pcs', NOW() - INTERVAL '4 days');

-- ----------------------------------------------------------------------------
-- 6. Waste records (each links to an item marked 'wasted')
-- ----------------------------------------------------------------------------
INSERT INTO public.food_waste (id, user_id, inventory_item_id, quantity, unit, reason, estimated_value, wasted_at) VALUES
('c0ffee35-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000020', 1.0, 'head',
 'Forgot it at the back of the crisper drawer', 75.00, NOW() - INTERVAL '3 days'),
('c0ffee35-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000021', 1.0, 'tub',
 'Went past its expiry while we were away for the weekend', 130.00, NOW() - INTERVAL '2 days');

-- ----------------------------------------------------------------------------
-- 7. Grocery list (mix of bought / still-to-buy items)
-- ----------------------------------------------------------------------------
INSERT INTO public.grocery_lists (id, user_id, name, created_at, updated_at) VALUES
('c0ffee40-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Weekly Restock', NOW() - INTERVAL '2 days', NOW()),
('c0ffee40-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Adobo + Sinigang run', NOW() - INTERVAL '1 day', NOW());

INSERT INTO public.grocery_items (id, grocery_list_id, name, category, quantity, unit, estimated_price, purchased, created_at) VALUES
('c0ffee41-0000-4000-8000-000000000001', 'c0ffee40-0000-4000-8000-000000000001', 'Soy Sauce 1L', 'Condiments', 1, 'bottle', 42.00, true,  NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000002', 'c0ffee40-0000-4000-8000-000000000001', 'White Vinegar 1L', 'Condiments', 1, 'bottle', 60.00, true,  NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000003', 'c0ffee40-0000-4000-8000-000000000001', 'Canned Sardines 155g', 'Pantry', 3, 'can', 35.00, false, NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000004', 'c0ffee40-0000-4000-8000-000000000001', 'Banana Ketchup 320g', 'Condiments', 1, 'bottle', 40.00, false, NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000005', 'c0ffee40-0000-4000-8000-000000000001', 'Chicken Bouillon Cubes', 'Pantry', 1, 'box', 28.00, false, NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000006', 'c0ffee40-0000-4000-8000-000000000001', 'Bay Leaves', 'Herbs', 1, 'box', 25.00, false, NOW() - INTERVAL '2 days'),
('c0ffee41-0000-4000-8000-000000000007', 'c0ffee40-0000-4000-8000-000000000002', 'Black Peppercorns', 'Herbs', 1, 'box', 45.00, false, NOW() - INTERVAL '1 day'),
('c0ffee41-0000-4000-8000-000000000008', 'c0ffee40-0000-4000-8000-000000000002', 'Fish Sauce (Patis)', 'Condiments', 1, 'bottle', 35.00, false, NOW() - INTERVAL '1 day');

-- ----------------------------------------------------------------------------
-- 8. Favorites + notification history + preferences
-- ----------------------------------------------------------------------------
INSERT INTO public.favorite_recipes (id, user_id, recipe_id, created_at) VALUES
('c0ffee50-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0ffee00-0000-4000-8000-000000000001', NOW() - INTERVAL '20 days'),
('c0ffee50-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0ffee00-0000-4000-8000-000000000002', NOW() - INTERVAL '12 days'),
('c0ffee50-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'c0ffee00-0000-4000-8000-000000000004', NOW() - INTERVAL '5 days');

INSERT INTO public.notification_logs (id, user_id, inventory_item_id, notification_type, sent_at) VALUES
('c0ffee36-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000001', 'expiration', NOW() - INTERVAL '20 hours'),
('c0ffee36-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000010', 'expiration', NOW() - INTERVAL '10 hours'),
('c0ffee36-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'c0ffee20-0000-4000-8000-000000000008', 'expiration', NOW() - INTERVAL '6 hours');

INSERT INTO public.notification_preferences (id, user_id, enabled, days_before, recipe_notifications, grocery_notifications, weekly_summary)
VALUES ('c0ffee60-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', true, 3, true, true, true);

INSERT INTO public.user_preferences (id, user_id, weight_unit, volume_unit, currency, language)
VALUES ('c0ffee70-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'g', 'ml', 'PHP', 'en');

COMMIT;