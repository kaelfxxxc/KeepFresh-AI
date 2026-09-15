// Centralized entitlement checks — the single place the app asks
// "is this user allowed to do X".
//
// Two layers, intentionally:
//
//   * The async functions call the database (`get_user_entitlements` and the
//     `can_*` functions). These are the authoritative answers and are what you
//     use before performing a write.
//
//   * The pure `gate*` helpers take an already-fetched `Entitlements` object
//     and answer instantly with a ready-to-render upgrade prompt. Screens use
//     these to decide what to show without a network round-trip.
//
// The database also enforces every one of these in triggers, so a modified
// client cannot exceed a plan. Nothing here is a security boundary — it is the
// user-facing half of one.

import { supabase } from '../lib/supabase';
import type { Entitlements, FeatureKey } from '../types';

/** A decision plus everything a UI needs to explain it. */
export interface GateResult {
  allowed: boolean;
  /** Short heading for an upgrade card, e.g. "Product limit reached". */
  title: string;
  /** One or two sentences the user can act on. */
  message: string;
  /** The tier that unlocks this, when one would. */
  requiredTier?: 'premium' | 'pro';
  /** Present when the gate is a countable cap. */
  used?: number;
  limit?: number | null;
}

const allowed = (): GateResult => ({ allowed: true, title: '', message: '' });

/**
 * Which tier a "you have hit the ceiling" prompt should point at.
 *
 * Not simply "the next tier up": the ladder differs by audience. A Household
 * account's next step is Premium; an Establishment's is Pro. `pro` and `premium`
 * already say where the user is, so they are taken at face value; anything below
 * them — the free floor, a free trial, or no plan at all — is resolved by
 * audience.
 */
function suggestedTier(e: Entitlements | null): 'premium' | 'pro' {
  if (e?.tier === 'pro' || e?.tier === 'premium') return 'pro';
  return e?.audience === 'establishment' ? 'pro' : 'premium';
}

/**
 * Error codes/messages the database raises when a limit is hit. Matching on
 * these lets a screen turn a failed write into the same upgrade prompt it would
 * have shown up front.
 */
const ENTITLEMENT_ERROR_KEYS: Record<string, { title: string; message: string; tier: 'premium' | 'pro' }> = {
  inventory_limit_reached: {
    title: 'Product limit reached',
    message: 'Your plan is full. Upgrade to add more products — nothing already stored is affected.',
    tier: 'premium',
  },
  ai_scan_limit_reached: {
    title: 'AI scan limit reached',
    message: 'You have used every scan in this month’s allowance. Upgrade for more, or add products manually.',
    tier: 'premium',
  },
  multiple_storage_not_in_plan: {
    title: 'Multiple storage areas',
    message: 'Your plan includes a single storage area. Upgrade to track a fridge, freezer and pantry separately.',
    tier: 'premium',
  },
  storage_area_limit_reached: {
    title: 'Storage area limit reached',
    message: 'You have used every storage area your plan allows. Upgrade to add more.',
    tier: 'premium',
  },
  bulk_inventory_not_in_plan: {
    title: 'Bulk inventory is not in your plan',
    message: 'Bulk add, edit and delete are included in Food Establishment Pro.',
    tier: 'pro',
  },
  staff_management_not_in_plan: {
    title: 'Staff accounts are not in your plan',
    message: 'Team logins and roles are included in Food Establishment Pro.',
    tier: 'pro',
  },
  no_live_subscription: {
    title: 'No plan to change',
    message: 'This plan has already ended, so there is nothing to cancel or resume. Choose a plan to start again.',
    tier: 'premium',
  },
};

/**
 * Turn a Supabase error into an upgrade prompt when it is a plan limit, or
 * `null` when it is an ordinary error the caller should surface itself.
 */
export function describeEntitlementError(error: unknown): GateResult | null {
  const raw = (error as { message?: string; hint?: string } | null)?.message ?? '';
  const hint = (error as { hint?: string } | null)?.hint ?? '';
  const haystack = `${raw} ${hint}`;

  for (const [key, value] of Object.entries(ENTITLEMENT_ERROR_KEYS)) {
    if (haystack.includes(key)) {
      return {
        allowed: false,
        title: value.title,
        message: hint || value.message,
        requiredTier: value.tier,
      };
    }
  }
  return null;
}

/** Percentage of a cap that has been used, clamped to 0–100. */
export function usagePercent(used: number, limit: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/* ------------------------------------------------------------------ pure gates */

export function gateAddProduct(e: Entitlements | null): GateResult {
  if (!e) return allowed();
  if (e.products_used < e.max_products) return allowed();
  return {
    allowed: false,
    title: 'Product limit reached',
    message: `You are using all ${e.max_products} products on ${e.plan_name}. Upgrade for more capacity — your existing items are safe.`,
    requiredTier: suggestedTier(e),
    used: e.products_used,
    limit: e.max_products,
  };
}

export function gateUseAIScan(e: Entitlements | null): GateResult {
  if (!e) return allowed();
  if (e.ai_scans_used < e.max_ai_scans) return allowed();
  return {
    allowed: false,
    title: 'AI scan limit reached',
    message: `You have used ${e.ai_scans_used} of ${e.max_ai_scans} scans this month. Upgrade for more, or enter products manually.`,
    requiredTier: suggestedTier(e),
    used: e.ai_scans_used,
    limit: e.max_ai_scans,
  };
}

function featureGate(
  e: Entitlements | null,
  key: FeatureKey,
  title: string,
  message: string,
  tier: 'premium' | 'pro' = 'premium'
): GateResult {
  if (!e) return allowed();
  const feature = e.features?.[key];
  if (feature?.enabled) return allowed();
  return { allowed: false, title, message, requiredTier: tier };
}

export function gateUsePriceTracking(e: Entitlements | null): GateResult {
  return featureGate(
    e,
    'price_tracking',
    'Price tracking is a Premium feature',
    'Track how product prices change over time and see what your groceries really cost.'
  );
}

export function gateUseWasteReport(e: Entitlements | null, advanced = false): GateResult {
  if (advanced) {
    return featureGate(
      e,
      'advanced_waste_report',
      'Advanced reports are a Pro feature',
      'Get category breakdowns, per-product losses and longer trend windows.'
    );
  }
  return featureGate(
    e,
    'waste_report',
    'Food waste reports are a Premium feature',
    'See exactly how much food — and money — you are throwing away each month.'
  );
}

export function gateUseMultipleStorage(e: Entitlements | null, currentCount = 0): GateResult {
  if (!e) return allowed();
  const feature = e.features?.multiple_storage;
  if (!feature?.enabled) {
    return {
      allowed: false,
      title: 'Multiple storage areas',
      message: 'Your plan tracks one storage area. Upgrade to organise a fridge, freezer and pantry separately.',
      requiredTier: 'premium',
    };
  }
  if (feature.limit != null && currentCount >= feature.limit) {
    return {
      allowed: false,
      title: 'Storage area limit reached',
      message: `Your plan allows ${feature.limit} storage area${feature.limit === 1 ? '' : 's'}. Upgrade to add more.`,
      requiredTier: suggestedTier(e),
      used: currentCount,
      limit: feature.limit,
    };
  }
  return allowed();
}

export function gateUseStaffManagement(e: Entitlements | null): GateResult {
  return featureGate(
    e,
    'staff_management',
    'Staff accounts are a Pro feature',
    'Add owners, managers and staff with role-based access to the same inventory.'
  );
}

export function gateUseBulkInventory(e: Entitlements | null): GateResult {
  return featureGate(
    e,
    'bulk_inventory',
    'Bulk inventory is a Pro feature',
    'Add, edit, delete and re-stock many products in a single operation.'
  );
}

/* ------------------------------------------------------------------- async API */

export const entitlementService = {
  /**
   * The authoritative entitlement snapshot. Falls back to `null` when the
   * network is unavailable so callers can keep rendering with what they had.
   */
  async get(userId?: string): Promise<Entitlements | null> {
    const { data, error } = await supabase.rpc('get_user_entitlements', {
      p_user_id: userId ?? null,
    });
    if (error) throw error;
    return (data as Entitlements) ?? null;
  },

  async canAddProduct(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_add_product', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  async canUseAIScan(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_ai_scan', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  async canUsePriceTracking(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_price_tracking', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  async canUseWasteReport(advanced = false, userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_waste_report', {
      p_advanced: advanced,
      p_user_id: userId ?? null,
    });
    if (error) throw error;
    return !!data;
  },

  async canUseMultipleStorage(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_multiple_storage', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  async canUseStaffManagement(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_staff_management', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  async canUseBulkInventory(userId?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_use_bulk_inventory', { p_user_id: userId ?? null });
    if (error) throw error;
    return !!data;
  },

  /** How many storage areas the plan allows. `null` means unlimited. */
  async storageAreaLimit(userId?: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('storage_area_limit', { p_user_id: userId ?? null });
    if (error) throw error;
    return (data as number | null) ?? null;
  },

  /**
   * Burn one AI scan. Throws `ai_scan_limit_reached` when the monthly
   * allowance is gone — check with `canUseAIScan`/`gateUseAIScan` first so the
   * user sees a prompt rather than an error.
   *
   * The increment happens server-side so it is atomic and cannot be replayed.
   */
  async consumeAIScan(userId?: string): Promise<{ ai_scans_used: number; max_ai_scans: number }> {
    const { data, error } = await supabase.rpc('consume_ai_scan', { p_user_id: userId ?? null });
    if (error) throw error;
    return data as { ai_scans_used: number; max_ai_scans: number };
  },
};
