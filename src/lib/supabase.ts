import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Profile,
  InventoryItem,
  Consumption,
  FoodWaste,
  Recipe,
  RecipeIngredient,
  FavoriteRecipe,
  GroceryList,
  GroceryItem,
  NotificationPreference,
  NotificationLog,
  UserPreference,
  SubscriptionPlan,
  FeatureEntitlement,
  UserSubscription,
  SubscriptionUsage,
  StorageArea,
  Organization,
  OrganizationMember,
  InventoryTransaction,
  PriceHistoryEntry,
} from '../types';

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
    detectSessionInUrl: true,
  },
});

// Reference types for the schema. The client itself is deliberately untyped so
// screens keep using the plain row shapes from `src/types`; this describes what
// the database actually offers, which is what the services are written against.
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

      // --- Subscriptions -----------------------------------------------------
      subscription_plans: SubscriptionPlan;
      feature_entitlements: FeatureEntitlement & { plan_id: string; feature_key: string };
      user_subscriptions: UserSubscription;
      subscription_usage: SubscriptionUsage;
      // Readable only by the service role: it holds purchase tokens that must
      // never be visible to a signed-in client.
      subscription_provider_receipts: {
        id: string;
        user_id: string;
        provider: string;
        purchase_token: string;
        product_id: string;
        verified_at: string | null;
        created_at: string;
      };

      // --- Inventory extras --------------------------------------------------
      storage_areas: StorageArea;
      inventory_transactions: InventoryTransaction;
      price_history: PriceHistoryEntry;
      organizations: Organization;
      organization_members: OrganizationMember;
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

      // --- Entitlements ------------------------------------------------------
      // The authoritative answer to "what may this user do". Screens read it
      // through SubscriptionContext rather than calling it directly.
      get_user_entitlements: {
        Args: { p_user_id?: string | null };
        Returns: import('../types').Entitlements;
      };
      can_add_product: { Args: { p_user_id?: string | null }; Returns: boolean };
      can_use_ai_scan: { Args: { p_user_id?: string | null }; Returns: boolean };
      can_use_price_tracking: { Args: { p_user_id?: string | null }; Returns: boolean };
      can_use_waste_report: {
        Args: { p_advanced?: boolean; p_user_id?: string | null };
        Returns: boolean;
      };
      can_use_multiple_storage: { Args: { p_user_id?: string | null }; Returns: boolean };
      can_use_staff_management: { Args: { p_user_id?: string | null }; Returns: boolean };
      can_use_bulk_inventory: { Args: { p_user_id?: string | null }; Returns: boolean };
      storage_area_limit: { Args: { p_user_id?: string | null }; Returns: number };
      // Atomic: increments only while the caller is under their monthly cap, so
      // two scans finishing at once cannot overshoot it.
      consume_ai_scan: { Args: { p_user_id?: string | null }; Returns: SubscriptionUsage };

      // --- Inventory writes --------------------------------------------------
      adjust_inventory_quantity: {
        Args: { p_item_id: string; p_delta: number };
        Returns: InventoryItem;
      };
      log_notification: {
        Args: {
          p_user_id: string;
          p_notification_type: string;
          p_dedupe_key?: string | null;
          p_inventory_item_id?: string | null;
          p_title?: string | null;
          p_body?: string | null;
        };
        Returns: boolean;
      };
      cancel_my_subscription: { Args: { p_at_period_end?: boolean }; Returns: UserSubscription };

      // --- Organisations -----------------------------------------------------
      create_organization: { Args: { p_name?: string | null }; Returns: Organization };
      add_org_member_by_email: {
        Args: { p_org: string; p_email: string; p_role?: string };
        Returns: OrganizationMember;
      };
      is_org_member: { Args: { p_org: string; p_user: string }; Returns: boolean };
      org_role: { Args: { p_org: string; p_user: string }; Returns: string | null };
      can_manage_org: { Args: { p_org: string; p_user: string }; Returns: boolean };
      shares_org_with: { Args: { p_other: string }; Returns: boolean };

      // --- Bulk inventory ----------------------------------------------------
      bulk_add_inventory: { Args: { p_items: unknown }; Returns: InventoryItem[] };
      bulk_update_inventory: { Args: { p_item_ids: string[]; p_updates: unknown }; Returns: number };
      bulk_adjust_quantity: { Args: { p_item_ids: string[]; p_delta: number }; Returns: number };
      bulk_delete_inventory: { Args: { p_item_ids: string[] }; Returns: number };
    };
  };
};