import { supabase } from '../lib/supabase';
import { Recipe, RecipeIngredient } from '../types';

export const recipeService = {
  async getRecipes(category?: string, limit: number = 20): Promise<Recipe[]> {
    let query = supabase.from('recipes').select('*').order('created_at', { ascending: false });
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getRecipe(id: string): Promise<Recipe | null> {
    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getRecommendedRecipes(userId: string): Promise<Recipe[]> {
    const { data, error } = await supabase.rpc('get_recipe_matches', {
      user_id: userId,
      limit: 10,
    });
    if (error) throw error;
    return data || [];
  },

  async toggleFavorite(userId: string, recipeId: string): Promise<void> {
    const { data: existing } = await supabase
      .from('favorite_recipes')
      .select('id')
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('favorite_recipes')
        .delete()
        .eq('user_id', userId)
        .eq('recipe_id', recipeId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('favorite_recipes')
        .insert({ user_id: userId, recipe_id: recipeId });
      if (error) throw error;
    }
  },

  async getFavorites(userId: string): Promise<Recipe[]> {
    const { data, error } = await supabase
      .from('favorite_recipes')
      .select('recipe:recipes(*)')
      .eq('user_id', userId);
    if (error) throw error;
    const rows: any[] = data || [];
    return rows.map((d) => d.recipe) as Recipe[];
  },

  async getRecipeIngredients(recipeId: string): Promise<RecipeIngredient[]> {
    const { data, error } = await supabase
      .from('recipe_ingredients')
      .select('*')
      .eq('recipe_id', recipeId);
    if (error) throw error;
    return data || [];
  },
};