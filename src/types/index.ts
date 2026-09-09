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
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  optional: boolean;
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
  inventory_item_id: string;
  notification_type: string;
  sent_at: string;
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

export type FilterType = 'all' | 'available' | 'need_to_buy' | 'expiring_soon' | 'expired';
export type TimeFilter = 'week' | 'month' | 'year';
export type RecipeCategory = 'all' | 'meals' | 'desserts' | 'snacks' | 'beverages';