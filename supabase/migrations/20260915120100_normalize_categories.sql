WITH mapped AS (
  SELECT
    id,
    category,
    CASE lower(trim(category))
      -- Legacy vocabulary from the seed data.
      WHEN 'meat & poultry'    THEN 'meat'
      WHEN 'meat and poultry'  THEN 'meat'
      WHEN 'eggs'              THEN 'dairy'
      WHEN 'herbs'             THEN 'condiments'
      WHEN 'spices'            THEN 'condiments'
      -- 'Pantry' becomes canned/packaged rather than grains: the seeded pantry
      -- rows are overwhelmingly tins, jars and bottles.
      WHEN 'pantry'            THEN 'canned'
      WHEN 'bakery'            THEN 'grains'
      -- Splits a combined label into the key that covers it.
      WHEN 'canned/packaged'   THEN 'canned'
      WHEN 'canned & packaged' THEN 'canned'
      WHEN 'packaged'          THEN 'canned'
      WHEN 'fruits'            THEN 'produce'
      WHEN 'fruit'             THEN 'produce'
      WHEN 'vegetables'        THEN 'produce'
      WHEN 'vegetable'         THEN 'produce'
      WHEN 'veggies'           THEN 'produce'
      WHEN 'drinks'            THEN 'beverages'
      -- Everything else is only a case/whitespace problem: 'Dairy' → 'dairy',
      -- 'Beverages' → 'beverages'. An unrecognised custom value is lowercased and
      -- kept, matching what the app would have stored.
      ELSE lower(trim(category))
    END AS normalized
  FROM public.inventory_items
  WHERE category IS NOT NULL
)
UPDATE public.inventory_items i
   SET category = m.normalized
  FROM mapped m
 WHERE i.id = m.id
   AND m.normalized IS DISTINCT FROM m.category;

-- ---------------------------------------------------------------------------
-- grocery_items — the same vocabulary, seeded as 'Condiments', 'Pantry', 'Herbs'.
-- No history trigger here, but the same WHERE keeps the write minimal.
-- ---------------------------------------------------------------------------
WITH mapped AS (
  SELECT
    id,
    category,
    CASE lower(trim(category))
      WHEN 'meat & poultry'    THEN 'meat'
      WHEN 'meat and poultry'  THEN 'meat'
      WHEN 'eggs'              THEN 'dairy'
      WHEN 'herbs'             THEN 'condiments'
      WHEN 'spices'            THEN 'condiments'
      WHEN 'pantry'            THEN 'canned'
      WHEN 'bakery'            THEN 'grains'
      WHEN 'canned/packaged'   THEN 'canned'
      WHEN 'canned & packaged' THEN 'canned'
      WHEN 'packaged'          THEN 'canned'
      WHEN 'fruits'            THEN 'produce'
      WHEN 'fruit'             THEN 'produce'
      WHEN 'vegetables'        THEN 'produce'
      WHEN 'vegetable'         THEN 'produce'
      WHEN 'veggies'           THEN 'produce'
      WHEN 'drinks'            THEN 'beverages'
      ELSE lower(trim(category))
    END AS normalized
  FROM public.grocery_items
  WHERE category IS NOT NULL
)
UPDATE public.grocery_items g
   SET category = m.normalized
  FROM mapped m
 WHERE g.id = m.id
   AND m.normalized IS DISTINCT FROM m.category;

-- recipes.category is deliberately untouched. It is a different taxonomy
-- ('meals' | 'desserts' | 'snacks' | 'beverages') that describes a dish, not a
-- grocery aisle, and shares no vocabulary with the keys above.

-- Confirm the result:
--   SELECT category, COUNT(*) FROM public.inventory_items GROUP BY 1 ORDER BY 1;
-- Only canonical keys should remain.
