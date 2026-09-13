// App-wide subscription state.
//
// Holds the authoritative entitlement snapshot, keeps it fresh over Supabase
// Realtime, and exposes the pure gate helpers pre-bound to the current
// entitlements so screens can render an upgrade prompt without a round-trip.
//
// Resilience rules:
//   * A failed refresh never clears what we already have — it marks it stale.
//     Losing the network must not lock a paying user out of their own pantry.
//   * Realtime is an accelerator. When the socket is down, focus and
//     pull-to-refresh still update everything.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { entitlementService, gateAddProduct, gateUseAIScan, gateUseBulkInventory, gateUsePriceTracking, gateUseStaffManagement, gateUseWasteReport, type GateResult } from '../services/entitlementService';
import { subscribeToTables, type RealtimeStatus } from '../lib/realtime';
import type { Entitlements } from '../types';

interface SubscriptionContextValue {
  entitlements: Entitlements | null;
  loading: boolean;
  /** Set when the last refresh failed. `entitlements` may still hold old data. */
  error: string | null;
  /** True when we are showing a cached snapshot because the network is down. */
  isStale: boolean;
  realtimeStatus: RealtimeStatus | null;
  /** Re-read entitlements from the database. Safe to call often. */
  refresh: () => Promise<void>;
  /**
   * Gate results pre-computed for the current entitlements. Screens that need a
   * count-aware gate (storage areas) call the pure helpers directly.
   */
  gates: {
    addProduct: GateResult;
    aiScan: GateResult;
    priceTracking: GateResult;
    wasteReport: GateResult;
    advancedWasteReport: GateResult;
    staffManagement: GateResult;
    bulkInventory: GateResult;
  };
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus | null>(null);

  // Guards against a slow response for a previous user landing after a fast
  // one for the current user (sign-out → sign-in as someone else).
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setEntitlements(null);
      setLoading(false);
      setIsStale(false);
      return;
    }

    const currentRequest = ++requestId.current;
    try {
      const next = await entitlementService.get(user.id);
      if (currentRequest !== requestId.current) return;
      if (next) {
        setEntitlements(next);
        setError(null);
        setIsStale(false);
      } else {
        // The RPC answered but gave us nothing — treat as stale rather than
        // wiping the snapshot.
        setIsStale(true);
      }
    } catch (e) {
      if (currentRequest !== requestId.current) return;
      setError((e as Error)?.message ?? 'Could not load your plan.');
      setIsStale(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [user]);

  // Initial load, and reload whenever the signed-in user changes.
  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Live updates: a plan change (verified purchase, expiry job) or a usage bump
  // (an AI scan finishing elsewhere) should reflect immediately.
  useEffect(() => {
    if (!user) return undefined;

    return subscribeToTables(
      `subscription:${user.id}`,
      ['user_subscriptions', 'subscription_usage'],
      () => { refresh(); },
      { userId: user.id, onStatus: setRealtimeStatus }
    );
  }, [user, refresh]);

  const gates = useMemo(
    () => ({
      addProduct: gateAddProduct(entitlements),
      aiScan: gateUseAIScan(entitlements),
      priceTracking: gateUsePriceTracking(entitlements),
      wasteReport: gateUseWasteReport(entitlements, false),
      advancedWasteReport: gateUseWasteReport(entitlements, true),
      staffManagement: gateUseStaffManagement(entitlements),
      bulkInventory: gateUseBulkInventory(entitlements),
    }),
    [entitlements]
  );

  const value = useMemo<SubscriptionContextValue>(
    () => ({ entitlements, loading, error, isStale, realtimeStatus, refresh, gates }),
    [entitlements, loading, error, isStale, realtimeStatus, refresh, gates]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}

/**
 * Convenience for screens that only need the plan and a way to refresh it.
 * Returns null-safe values so callers never have to guard on `entitlements`.
 */
export function useEntitlements() {
  const { entitlements, loading, refresh } = useSubscription();
  return { entitlements, loading, refresh };
}
