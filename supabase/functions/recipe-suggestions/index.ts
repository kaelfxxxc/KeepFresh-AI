// recipe-suggestions
// Ranks the recipe catalog against what a user actually has in their pantry.
// Better than the simple DB function: it tokenizes inventory product/brand
// names against each recipe ingredient and scores coverage, so suggestions are
// genuinely "recipes you can cook right now".
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/recipe-suggestions \
//     -H "Authorization: Bearer <user access token>"
//   Optional JSON body: { "category": "meals" | "desserts" | "snacks" | "beverages", "limit": 8 }

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { json, handleOptions } from '../_shared/cors.ts';

type Recipe = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  prep_time: number | null;
  servings: number | null;
  recipe_ingredients: Array<{ ingredient_name: string; quantity: number | null; unit: string | null; optional: boolean | null }>;
};

// Lower-case tokens that carry meaning ("fresh", "boneless", "flakes" etc. drop
// out so "Fresh Milk" still matches "milk" and "canned tuna" matches "tuna").
const STOP = new Set([
  'the', 'a', 'an', 'fresh', 'boneless', 'whole', 'plain', 'large', 'small',
  'canned', 'flakes', 'oil', 'box', 'pack', 'bottle', 'can', 'tub', 'loaf',
  '1l', '1kg', 'slices', 'finger',
]);

function tokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const t = raw.trim();
    if (t.length >= 3 && !STOP.has(t)) out.add(t);
  }
  return out;
}

function matchScore(ingredient: string, inventoryTokens: Set<string>): number {
  const ing = tokens(ingredient);
  if (ing.size === 0) return 0;
  let hits = 0;
  for (const t of ing) if (inventoryTokens.has(t)) hits++;
  return hits / ing.size; // 1.0 = full name found in pantry
}

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const userId = await userIdFromRequest(req);
    if (!userId) return json({ ok: false, error: 'Missing or invalid access token' }, 401);

    let category: string | null = null;
    let limit = 8;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      category = body.category ?? null;
      limit = body.limit ?? 8;
    }

    // Everything the user has that is still usable.
    const { data: inventory, error: invErr } = await supabaseAdmin
      .from('inventory_items')
      .select('product_name, brand')
      .eq('user_id', userId)
      .not('status', 'in', '("consumed","wasted")');
    if (invErr) throw invErr;

    const inventoryTokens = new Set<string>();
    for (const item of inventory ?? []) {
      for (const t of tokens(item.product_name)) inventoryTokens.add(t);
      for (const t of tokens(item.brand)) inventoryTokens.add(t);
    }

    let query = supabaseAdmin
      .from('recipes')
      .select('id, name, description, category, difficulty, prep_time, servings, recipe_ingredients(ingredient_name, quantity, unit, optional)')
      .order('created_at', { ascending: false });
    if (category && category !== 'all') query = query.eq('category', category);
    const { data: recipes, error: recErr } = await query.limit(40);
    if (recErr) throw recErr;

    const scored = (recipes as Recipe[] ?? [])
      .map((r) => {
        const required = (r.recipe_ingredients ?? []).filter((i) => !i.optional);
        const all = (r.recipe_ingredients ?? []).map((i) => i.ingredient_name);
        if (all.length === 0) return null;

        const matched = all.filter((name) => matchScore(name, inventoryTokens) > 0.55);
        const needed = required.length;
        const matchedRequired = required.filter((i) => matchScore(i.ingredient_name, inventoryTokens) > 0.55).length;
        const coverage = matchedRequired / Math.max(needed, 1);

        return {
          recipe: {
            id: r.id,
            name: r.name,
            description: r.description,
            category: r.category,
            difficulty: r.difficulty,
            prep_time: r.prep_time,
            servings: r.servings,
          },
          matched_ingredients: matched,
          missing_ingredients: all.filter((name) => !matched.includes(name)),
          coverage: Math.round(coverage * 100),
          can_cook_now: coverage === 1 && matchedRequired === needed,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.coverage - a.coverage || b.matched_ingredients.length - a.matched_ingredients.length)
      .slice(0, limit);

    return json({ ok: true, user_id: userId, suggestions: scored });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
