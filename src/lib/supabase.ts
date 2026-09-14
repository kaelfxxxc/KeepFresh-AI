import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveSupabaseConfig, SupabaseConfigError } from './supabaseConfig';
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

/**
 * Resolved once, at import time, so every consumer and the root layout agree on
 * the same answer and the same error.
 */
export const supabaseConfig = resolveSupabaseConfig();

/** Non-null only when configuration is missing — rendered by `app/_layout.tsx`. */
export const supabaseConfigError: SupabaseConfigError | null = supabaseConfig.ok
  ? null
  : new SupabaseConfigError(supabaseConfig.message, supabaseConfig.missing);

/**
 * The client is deliberately left untyped so screens keep using the plain row
 * shapes from `src/types`, matching the original `createClient` inference.
 *
 * Note: this must be the `SupabaseClient` type itself, not
 * `ReturnType<typeof createClient>` — the latter resolves the generic defaults
 * of the last overload and collapses every row type to `never` under
 * @supabase/supabase-js v2.116.
 */
export type AppSupabaseClient = SupabaseClient;

/**
 * The app's single Supabase client.
 *
 * Created here and nowhere else in the app. `supabase/functions/_shared/
 * supabase.ts` holds a second `createClient` call, but that one is a Deno edge
 * function running server-side with the service-role key — it is not reachable
 * from, and never bundled into, the mobile app.
 */
export const supabase: AppSupabaseClient = supabaseConfig.ok
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : createUnconfiguredClient(supabaseConfigError!);

/**
 * Stand-in used only when configuration is missing.
 *
 * Calling anything on it throws the configuration error — which names the
 * missing variables and how to set them — instead of the bare
 * `supabaseUrl is required.` that `createClient` produces.
 *
 * It deliberately does not throw on property *access*: modules touch
 * `supabase.auth` while setting themselves up, and throwing there would abort
 * module evaluation and reintroduce exactly the crash this guards against. The
 * throw is deferred to the call, where the root layout has already had the
 * chance to render the configuration error screen instead of the app.
 */
/**
 * The stand-in's type.
 *
 * Declared rather than inferred because the `get` trap returns the proxy from
 * inside its own initializer, and TypeScript cannot infer a type that refers to
 * itself — TS7022. (TypeScript 5.9 happens to resolve it; the 5.3 that SDK 51
 * pins does not, so the annotation has to be explicit.)
 *
 * Every property — however deep the chain — is another stand-in. `undefined` is
 * reserved for `then`, so the object is never mistaken for a thenable.
 */
interface UnconfiguredSupabaseClient {
  [property: string]: UnconfiguredSupabaseClient | undefined;
}

function createUnconfiguredClient(error: SupabaseConfigError): AppSupabaseClient {
  // Self-referential: `supabase.auth.getSession` and
  // `supabase.from(...).select(...)` both resolve to this same stand-in, and
  // calling it throws the configuration error. Throwing on the call rather than
  // on the access is what keeps module setup working.
  const unconfigured: UnconfiguredSupabaseClient = new Proxy(
    function unconfiguredClient() {} as unknown as object,
    {
      get: (_target, property) => (property === 'then' ? undefined : unconfigured),
      apply: () => {
        throw error;
      },
    }
  ) as unknown as UnconfiguredSupabaseClient;

  // Through `unknown`: the stand-in deliberately shares no structure with a real
  // client, so there is no overlap for a direct assertion to work from.
  return unconfigured as unknown as AppSupabaseClient;
}

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