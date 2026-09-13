// Subscription reads and self-service actions.
//
// Everything that GRANTS entitlement lives server-side (the trial trigger and
// the `subscription-verify` edge function). This service can only read state
// and flip the two cancellation flags a user is allowed to control.

import { supabase } from '../lib/supabase';
import type {
  BillingPeriod,
  Entitlements,
  FeatureEntitlement,
  FeatureKey,
  PlanAudience,
  SubscriptionPlan,
  SubscriptionUsage,
  UserSubscription,
} from '../types';
import { entitlementService } from './entitlementService';

/** Plans grouped the way the subscription screen renders them. */
export interface PlanGroup {
  audience: PlanAudience;
  audienceLabel: string;
  tiers: {
    tier: SubscriptionPlan['tier'];
    tierLabel: string;
    monthly: SubscriptionPlan | null;
    yearly: SubscriptionPlan | null;
    trial: SubscriptionPlan | null;
  }[];
}

const AUDIENCE_LABELS: Record<PlanAudience, string> = {
  household: 'Household',
  establishment: 'Food Establishment',
};

const TIER_LABELS: Record<SubscriptionPlan['tier'], string> = {
  free_trial: 'Free Trial',
  premium: 'Premium',
  pro: 'Pro',
};

/**
 * How each entitlement reads on a plan card.
 *
 * Kept beside the plan list rather than in the screen so the wording and the
 * keys can be checked against each other in one place — a feature added to the
 * matrix without a label here shows up as its raw key, which is a visible bug
 * rather than a silent omission.
 */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  manual_entry: 'Manual item entry',
  expiration_alerts: 'Expiration alerts',
  ai_recipes: 'AI recipe suggestions',
  smart_grocery_list: 'Smart grocery list',
  waste_report: 'Food waste & savings report',
  advanced_waste_report: 'Advanced waste & savings analytics',
  price_tracking: 'Product price tracking',
  multiple_storage: 'Multiple storage areas',
  advanced_inventory: 'Advanced inventory controls',
  staff_management: 'Staff accounts & roles',
  bulk_inventory: 'Bulk inventory tools',
};

/** Features shown in this order on a plan card, regardless of key order. */
const FEATURE_ORDER: FeatureKey[] = [
  'manual_entry',
  'expiration_alerts',
  'ai_recipes',
  'smart_grocery_list',
  'waste_report',
  'advanced_waste_report',
  'price_tracking',
  'multiple_storage',
  'advanced_inventory',
  'staff_management',
  'bulk_inventory',
];

export const subscriptionService = {
  /** The full active price list, cheapest tier first. */
  async getPlans(): Promise<SubscriptionPlan[]> {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /** Group plans into the {audience → tier → monthly/yearly} shape the UI wants. */
  async getPlanGroups(): Promise<PlanGroup[]> {
    const plans = await this.getPlans();
    const groups: PlanGroup[] = [];

    (['household', 'establishment'] as PlanAudience[]).forEach((audience) => {
      const forAudience = plans.filter((p) => p.audience === audience);
      if (forAudience.length === 0) return;

      const tiers: PlanGroup['tiers'] = [];
      (['free_trial', 'premium', 'pro'] as SubscriptionPlan['tier'][]).forEach((tier) => {
        const forTier = forAudience.filter((p) => p.tier === tier);
        if (forTier.length === 0) return;
        tiers.push({
          tier,
          tierLabel: TIER_LABELS[tier],
          monthly: forTier.find((p) => p.billing_period === 'monthly') ?? null,
          yearly: forTier.find((p) => p.billing_period === 'yearly') ?? null,
          trial: forTier.find((p) => p.billing_period === 'trial') ?? null,
        });
      });

      groups.push({ audience, audienceLabel: AUDIENCE_LABELS[audience], tiers });
    });

    return groups;
  },

  async getPlan(planId: string): Promise<SubscriptionPlan | null> {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Every plan's entitlement row, keyed `planId → featureKey`.
   *
   * The plan cards render from this rather than from a hardcoded list, so what
   * a card promises is exactly what the database will allow.
   */
  async getFeatureMatrix(): Promise<Record<string, Record<string, FeatureEntitlement>>> {
    const { data, error } = await supabase
      .from('feature_entitlements')
      .select('plan_id, feature_key, enabled, limit_value');
    if (error) throw error;

    const matrix: Record<string, Record<string, FeatureEntitlement>> = {};
    (data ?? []).forEach(
      (row: { plan_id: string; feature_key: string; enabled: boolean; limit_value: number | null }) => {
        if (!matrix[row.plan_id]) matrix[row.plan_id] = {};
        matrix[row.plan_id][row.feature_key] = {
          enabled: row.enabled,
          limit: row.limit_value ?? null,
        };
      }
    );
    return matrix;
  },

  /** The enabled features for one plan, in display order, with their labels. */
  describeFeatures(
    features: Record<string, FeatureEntitlement> | undefined
  ): { key: FeatureKey; label: string; limit: number | null }[] {
    if (!features) return [];
    return FEATURE_ORDER.filter((key) => features[key]?.enabled).map((key) => ({
      key,
      label: FEATURE_LABELS[key],
      limit: features[key]?.limit ?? null,
    }));
  },

  /** The user's live subscription row, if any. */
  async getCurrentSubscription(userId: string): Promise<UserSubscription | null> {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['trialing', 'active', 'past_due'])
      .order('current_period_end', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },

  /** This month's counters. */
  async getUsage(userId: string): Promise<SubscriptionUsage | null> {
    const periodStart = firstOfMonth(new Date()).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('subscription_usage')
      .select('*')
      .eq('user_id', userId)
      .eq('period_start', periodStart)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Same authoritative snapshot the database enforces with. */
  async getEntitlements(userId?: string): Promise<Entitlements | null> {
    return entitlementService.get(userId);
  },

  /**
   * Turn off renewal. Access continues until `current_period_end` — the plan
   * does not end early and no inventory is touched.
   */
  async cancelMySubscription(atPeriodEnd = true): Promise<UserSubscription> {
    const { data, error } = await supabase.rpc('cancel_my_subscription', {
      p_at_period_end: atPeriodEnd,
    });
    if (error) throw error;
    return data as UserSubscription;
  },

  /** Undo a cancellation before the period ends. */
  async resumeMySubscription(): Promise<UserSubscription> {
    return this.cancelMySubscription(false);
  },
};

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/* -------------------------------------------------------------- pure helpers */

/** Whole days until the period ends. Negative once it has lapsed. */
export function daysRemaining(periodEnd: string | null | undefined): number {
  if (!periodEnd) return 0;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * How the current plan should be described in a header or badge.
 * Deliberately distinguishes "trialing" from "active" from "lapsed", because
 * the upgrade messaging differs for each.
 */
export function describeStatus(entitlements: Entitlements | null): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (!entitlements) return { label: 'Loading', tone: 'neutral' };

  const days = daysRemaining(entitlements.current_period_end);

  switch (entitlements.status) {
    case 'trialing':
      return days <= 2
        ? { label: `Trial ends in ${Math.max(days, 0)}d`, tone: 'warning' }
        : { label: `Free trial · ${Math.max(days, 0)}d left`, tone: 'success' };
    case 'active':
      return entitlements.cancel_at_period_end
        ? { label: `Ends in ${Math.max(days, 0)}d`, tone: 'warning' }
        : { label: 'Active', tone: 'success' };
    case 'past_due':
      return { label: 'Payment due', tone: 'danger' };
    case 'canceled':
      return { label: 'Cancelled', tone: 'neutral' };
    case 'expired':
      return { label: 'Expired', tone: 'danger' };
    default:
      return { label: 'No plan', tone: 'neutral' };
  }
}

/** Yearly plans are sold as "two months free" — show the real saving. */
export function yearlySavingPercent(monthly: SubscriptionPlan | null, yearly: SubscriptionPlan | null): number | null {
  if (!monthly || !yearly || monthly.price_php <= 0) return null;
  const fullYear = monthly.price_php * 12;
  if (fullYear <= 0) return null;
  return Math.round(((fullYear - yearly.price_php) / fullYear) * 100);
}

/** The product IDs a store adapter would look up. */
export function storeProductId(plan: Pick<SubscriptionPlan, 'id'>): string {
  return plan.id;
}

/** Only monthly/yearly plans are purchasable. */
export function isPurchasable(plan: SubscriptionPlan): boolean {
  return plan.billing_period === 'monthly' || plan.billing_period === 'yearly';
}

export function periodLabel(period: BillingPeriod): string {
  return period === 'monthly' ? 'Monthly' : period === 'yearly' ? 'Yearly' : 'Trial';
}
