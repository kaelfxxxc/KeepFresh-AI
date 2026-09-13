// Subscription, entitlement and multi-area inventory types.
//
// These mirror the schema created by
// supabase/migrations/20260914120000_subscriptions_entitlements.sql.
// Re-exported from src/types so screens can import everything from one place.

export type PlanAudience = 'household' | 'establishment';
export type PlanTier = 'free_trial' | 'premium' | 'pro';
export type BillingPeriod = 'trial' | 'monthly' | 'yearly';

/** A purchasable plan. `price_php` is display-only — the store is authoritative. */
export interface SubscriptionPlan {
  id: string;
  audience: PlanAudience;
  tier: PlanTier;
  billing_period: BillingPeriod;
  name: string;
  description: string | null;
  price_php: number;
  duration_days: number;
  max_products: number;
  max_ai_scans: number;
  sort_order: number;
  is_active: boolean;
}

/** 'none' only ever appears on a resolved Entitlements object, never on a row. */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'none';

export type PaymentProvider = 'none' | 'google_play' | 'app_store' | 'stripe' | 'manual';

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: Exclude<SubscriptionStatus, 'none'>;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  auto_renew: boolean;
  canceled_at: string | null;
  provider: PaymentProvider;
  provider_subscription_id: string | null;
  provider_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export type FeatureKey =
  | 'manual_entry'
  | 'expiration_alerts'
  | 'ai_recipes'
  | 'smart_grocery_list'
  | 'waste_report'
  | 'advanced_waste_report'
  | 'price_tracking'
  | 'multiple_storage'
  | 'advanced_inventory'
  | 'staff_management'
  | 'bulk_inventory';

export interface FeatureEntitlement {
  enabled: boolean;
  /** NULL means unlimited; a number is a hard cap (e.g. storage areas). */
  limit: number | null;
}

/**
 * The resolved answer to "what is this user allowed to do right now".
 * Produced by the `get_user_entitlements` RPC — the database is the source of
 * truth, so never construct one of these by hand on the client.
 */
export interface Entitlements {
  user_id: string;
  account_type: PlanAudience;
  plan_id: string;
  plan_name: string;
  audience: PlanAudience;
  tier: PlanTier;
  billing_period: BillingPeriod;
  price_php: number;
  status: SubscriptionStatus;
  /** True when the period is unexpired AND the status is trialing/active. */
  is_active: boolean;
  started_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  auto_renew: boolean;
  provider: PaymentProvider;
  /** A paid plan is only trustworthy once the server has verified a receipt. */
  is_verified_paid: boolean;
  max_products: number;
  products_used: number;
  max_ai_scans: number;
  ai_scans_used: number;
  usage_period_start: string;
  features: Record<string, FeatureEntitlement>;
}

export interface SubscriptionUsage {
  id: string;
  user_id: string;
  subscription_id: string | null;
  period_start: string;
  period_end: string;
  ai_scans_used: number;
  products_added: number;
  updated_at: string;
}

export type StorageKind = 'refrigerator' | 'freezer' | 'pantry' | 'cabinet' | 'custom';

export interface StorageArea {
  id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  kind: StorageKind;
  icon: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type InventoryAction =
  | 'created'
  | 'updated'
  | 'quantity_increase'
  | 'quantity_decrease'
  | 'consumed'
  | 'wasted'
  | 'deleted'
  | 'bulk_add'
  | 'bulk_update'
  | 'bulk_delete'
  | 'storage_moved'
  | 'expiration_changed';

export interface InventoryTransaction {
  id: string;
  user_id: string;
  actor_id: string | null;
  organization_id: string | null;
  inventory_item_id: string | null;
  product_name: string | null;
  action: InventoryAction;
  quantity_before: number | null;
  quantity_after: number | null;
  delta: number | null;
  unit: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface PriceHistoryEntry {
  id: string;
  user_id: string;
  inventory_item_id: string | null;
  organization_id: string | null;
  product_name: string;
  barcode: string | null;
  price: number;
  previous_price: number | null;
  currency: string;
  supplier: string | null;
  purchase_date: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export type OrgRole = 'owner' | 'manager' | 'staff';
export type OrgMemberStatus = 'invited' | 'active' | 'removed';

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  account_type: PlanAudience;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  status: OrgMemberStatus;
  invited_email: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The alert-timing menu the spec fixes: on the day, or 1/3/5/7 days before. */
export type ExpirationAlertDays = 0 | 1 | 3 | 5 | 7;
export const EXPIRATION_ALERT_OPTIONS: { value: ExpirationAlertDays; label: string }[] = [
  { value: 7, label: '7 days before' },
  { value: 5, label: '5 days before' },
  { value: 3, label: '3 days before' },
  { value: 1, label: '1 day before' },
  { value: 0, label: 'On the day' },
];

/** The windows the report screen can be switched between. */
export type ReportWindow = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Aggregated food-waste / savings figures for a reporting window.
 *
 * Everything through `trend` comes from the basic `waste_report` entitlement.
 * The trailing fields are filled in only for `advanced_waste_report` plans, so
 * consumers must treat them as optional rather than rendering blanks.
 */
export interface WasteReport {
  window: ReportWindow;
  periodStart: string;
  periodEnd: string;
  /** Sum of `estimated_value` for items thrown away in the window. */
  wastedValue: number;
  itemsWasted: number;
  /** Value of food that was eaten rather than binned. */
  consumedValue: number;
  /** How many consume events that figure came from. */
  itemsConsumed: number;
  /** Same figure as `consumedValue`, named for how it is presented. */
  estimatedSavings: number;
  /** wastedValue / (wastedValue + consumedValue), 0–100. */
  wastePercent: number;
  /** The remaining share — how much of the outflow was actually eaten. */
  savingsPercent: number;
  currency: string;
  /** Money wasted per category, biggest loss first. */
  byCategory: { label: string; value: number; count: number }[];
  /** The individual products that were wasted, biggest loss first. */
  topProducts: { name: string; value: number; count: number }[];
  /** One entry per bucket in the window, zero-filled so gaps read as zero. */
  trend: { label: string; value: number; count: number }[];

  // ---- Advanced tier only ---------------------------------------------------
  /** Why items were binned. */
  byReason?: { label: string; value: number; count: number }[];
  /** Mean waste per bucket — the basis for the projection below. */
  averagePerBucket?: number;
  /** Average extended over a year, for "this habit costs you…" framing. */
  projectedYearlyWaste?: number;
}
