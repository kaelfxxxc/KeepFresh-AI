import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Accept both the canonical name and the older _PROJECT_URL variant so a stale
// .env can never silently hand createClient an undefined URL.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_PROJECT_URL ||
  '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInMount: true,
  },
});

export type Database = {
  public: {
    Tables: {
      profiles: Omit<Profile, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };
      inventory_items: Omit<InventoryItem, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };
      inventory_consumption: Omit<Consumption, 'consumed_at'> & { consumed_at: string };
      food_waste: Omit<FoodWaste, 'wasted_at'> & { wasted_at: string };
      recipes: Omit<Recipe, 'created_at'> & { created_at: string };
      recipe_ingredients: Omit<RecipeIngredient, 'optional'> & { optional: boolean };
      favorite_recipes: Omit<FavoriteRecipe, 'created_at'> & { created_at: string };
      grocery_lists: Omit<GroceryList, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };
      grocery_items: Omit<GroceryItem, 'created_at'> & { created_at: string };
      notification_preferences: Omit<NotificationPreference, 'updated_at'> & { updated_at: string };
      notification_logs: Omit<NotificationLog, 'sent_at'> & { sent_at: string };
      user_preferences: Omit<UserPreference, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };
    };
    Functions: {
      consume_inventory_item: {
        Args: { p_user_id: string; p_item_id: string; p_quantity?: number };
        Returns: undefined;
      };
      get_expiring_items: { Args: { user_id: string; days: number }; Returns: InventoryItem[] };
      calculate_food_waste: { Args: { user_id: string; start_date: string; end_date: string }; Returns: number };
      calculate_food_consumption: { Args: { user_id: string; start_date: string; end_date: string }; Returns: number };
      calculate_estimated_savings: { Args: { user_id: string; start_date: string; end_date: string }; Returns: number };
      get_recipe_matches: { Args: { user_id: string; category?: string; limit?: number }; Returns: Recipe[] };
    };
  };
};