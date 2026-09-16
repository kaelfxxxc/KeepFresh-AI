// Subscription / entitlement / multi-area types live in their own module and
// are re-exported here so every screen keeps importing from '../types'.
export * from './subscription';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_type: 'household' | 'establishment';
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  user_id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  barcode: string | null;
  quantity: number;
  unit: string;
  purchase_date: string | null;
  expiration_date: string | null;
  price: number | null;
  image_url: string | null;
  notes: string | null;
  status: 'available' | 'consumed' | 'wasted' | 'expired';
  /**
   * The user flagged this as something to buy more of — the heart on the item
   * screen. Independent of `status`: the item can still be in stock. Need to Buy
   * shows `status IN ('consumed','wasted')` *or* this flag.
   */
  need_to_buy: boolean;
  // Added by 20260914120000_subscriptions_entitlements.sql
  storage_area_id: string | null;
  organization_id: string | null;
  added_by: string | null;
  /** How many days before expiry to raise an alert. One of 0 | 1 | 3 | 5 | 7. */
  expiration_alert_days: number;
  created_at: string;
  updated_at: string;
}

export interface Consumption {
  id: string;
  user_id: string;
  inventory_item_id: string;
  quantity: number;
  unit: string;
  consumed_at: string;
}

export interface FoodWaste {
  id: string;
  user_id: string;
  inventory_item_id: string;
  quantity: number;
  unit: string;
  reason: string | null;
  estimated_value: number | null;
  wasted_at: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  prep_time: number;
  servings: number;
  instructions: string[];
  created_at: string;
  // Added by ai_recipes.sql
  /**
   * `null` for the shared catalog seeded by seed.sql. Set on recipes the
   * recipe-suggestions function generated for one user — and the app only ever
   * selects those, so the catalog is out of the runtime path.
   */
  user_id: string | null;
  /** Time on the heat, kept apart from the hands-on `prep_time`. */
  cook_time: number | null;
  /** 0–100. Share of non-optional ingredients found in inventory when generated. */
  match_percent: number | null;
  /** The dish phrase the image search ran with. */
  image_query: string | null;
  source: 'catalog' | 'ai';
  generated_at: string | null;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  optional: boolean;
  // Added by ai_recipes.sql
  /**
   * Whether the ingredient was in the user's inventory when the recipe was
   * generated. The detail screen's "you have" / "you need" split is derived from
   * this one column, so the two lists cannot disagree.
   */
  available: boolean;
}

/**
 * A recipe as the list screen renders it: the row plus a rollup of its
 * ingredients, so the card can show coverage without a second query per item.
 */
export interface RecipeWithIngredients extends Recipe {
  ingredient_names: string[];
  available_count: number;
  total_count: number;
}

export interface FavoriteRecipe {
  id: string;
  user_id: string;
  recipe_id: string;
  created_at: string;
}

export interface GroceryList {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GroceryItem {
  id: string;
  grocery_list_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  estimated_price: number | null;
  purchased: boolean;
  created_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  enabled: boolean;
  days_before: number;
  recipe_notifications: boolean;
  grocery_notifications: boolean;
  weekly_summary: boolean;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  inventory_item_id: string | null;
  notification_type: string;
  /**
   * Identifies the exact occasion a notification was about. A unique index on
   * (user_id, dedupe_key) makes a repeated send a no-op; NULL rows are exempt,
   * because Postgres keeps NULLs distinct.
   */
  dedupe_key: string | null;
  title: string | null;
  body: string | null;
  sent_at: string;
  // Added by notification_center.sql
  /**
   * When this notification is (or was) due.
   *
   * Not the same thing as `sent_at`, which is NOW() on both write paths and so
   * cannot tell a reminder queued for next Tuesday from one announced a second
   * ago. The bell's list reads `deliver_at <= now`, so a queued reminder stays
   * out of it until its time comes.
   *
   * Absent on a database that has not had that migration pasted, and NULL on
   * rows written before it — so reads of it are nullish-guarded.
   */
  deliver_at: string | null;
  /** NULL means unread. Written only by the mark-read RPCs, never by the client. */
  read_at: string | null;
}

export interface UserPreference {
  id: string;
  user_id: string;
  weight_unit: 'g' | 'kg' | 'oz' | 'lb';
  volume_unit: 'ml' | 'l' | 'cups';
  currency: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export type ExpirationStatus = 'expired' | 'today' | 'expiring_soon' | 'safe';

export interface DashboardStats {
  totalItems: number;
  needToBuy: number;
  expirationAlerts: number;
  wasteThisMonth: number;
  wastePercentage: number;
  estimatedSavings: number;
}

export interface AnalyticsData {
  foodUsed: number;
  totalItems: number;
  itemsUsed: number;
  itemsWasted: number;
  wasteBreakdown: Record<string, number>;
  estimatedSavings: number;
}

/**
 * The Inventory tab's chips. Mirrors the `Filter` union in
 * app/(tabs)/inventory.tsx — kept in step by hand, since the screen keeps its
 * own copy to avoid importing a type from the barrel it already sits beside.
 *
 * It previously listed `available`/`expiring_soon`/`expired`, none of which have
 * been filter values on that screen for some time.
 */
export type FilterType = 'all' | 'expiring' | 'need_to_buy' | 'history';
export type TimeFilter = 'week' | 'month' | 'year';
export type RecipeCategory = 'all' | 'meals' | 'desserts' | 'snacks' | 'beverages';