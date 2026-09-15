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
//
// Trial expiry rides on the same path. `refresh()` calls `sync_my_subscription`,
// which brings this user's own row up to date and hands back freshly computed
// entitlements; a foreground listener re-runs it, because returning to the app
// is the moment a trial most plausibly ran out while the user was away.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { gateAddProduct, gateUseAIScan, gateUseBulkInventory, gateUsePriceTracking, gateUseStaffManagement, gateUseWasteReport, type GateResult } from '../services/entitlementService';
import { subscriptionService, trialHasEnded } from '../services/subscriptionService';
import { subscribeToTables, type RealtimeStatus } from '../lib/realtime';
import type { Entitlements } from '../types';

/**
 * How long a refresh is considered fresh before returning to the foreground
 * triggers another one.
 *
 * Long enough that flicking between apps does not hammer the RPC, short enough
 * that a trial ending while the app sat in the background is noticed the next
 * time it is opened.
 */
const FOREGROUND_REFRESH_MS = 60_000;

/** One acknowledgement per trial, keyed by the trial's own end date. */
const ACK_KEY_PREFIX = 'keepfresh:trial-ended-ack';

interface SubscriptionContextValue {
  entitlements: Entitlements | null;
  loading: boolean;
  /** Set when the last refresh failed. `entitlements` may still hold old data. */
  error: string | null;
  /** True when we are showing a cached snapshot because the network is down. */
  isStale: boolean;
  realtimeStatus: RealtimeStatus | null;
  /**
   * True when a free trial has just been found to be over and the user has not
   * been told about it yet. Cleared by `acknowledgeTrialEnded`.
   */
  trialJustEnded: boolean;
  /** Mark the trial-ended notice as shown, so it never appears twice. */
  acknowledgeTrialEnded: () => Promise<void>;
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
  const [trialJustEnded, setTrialJustEnded] = useState(false);

  // Guards against a slow response for a previous user landing after a fast
  // one for the current user (sign-out → sign-in as someone else).
  const requestId = useRef(0);
  /** What the last successful read said, so a transition can be spotted. */
  const trialEndedRef = useRef(false);
  const lastRefreshRef = useRef(0);

  const userId = user?.id ?? null;

  /**
   * Decide whether the trial-ended notice should be raised.
   *
   * Keyed on the trial's own end date so it is genuinely once per trial rather
   * than once per launch — and so a *new* trial on the same account would still
   * notify. Answered from storage rather than memory because the case that
   * matters most is a cold start days after the trial ended.
   */
  const considerTrialEnd = useCallback(
    async (next: Entitlements) => {
      const ended = trialHasEnded(next);
      const wasEnded = trialEndedRef.current;
      trialEndedRef.current = ended;

      if (!ended || wasEnded) return;

      const key = `${ACK_KEY_PREFIX}:${userId ?? 'anon'}:${next.trial_ends_at ?? ''}`;
      try {
        if (await AsyncStorage.getItem(key)) return;
      } catch {
        // Unreadable storage means we cannot tell whether they have been told.
        // Showing the notice is the more useful failure: being told twice is a
        // far smaller problem than never being told your plan changed.
      }
      setTrialJustEnded(true);
    },
    [userId]
  );

  const refresh = useCallback(async () => {
    if (!user) {
      setEntitlements(null);
      setLoading(false);
      setIsStale(false);
      trialEndedRef.current = false;
      setTrialJustEnded(false);
      return;
    }

    const currentRequest = ++requestId.current;
    lastRefreshRef.current = Date.now();
    try {
      const next = await subscriptionService.syncMySubscription();
      if (currentRequest !== requestId.current) return;
      if (next) {
        setEntitlements(next);
        setError(null);
        setIsStale(false);
        await considerTrialEnd(next);
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
  }, [user, considerTrialEnd]);

  const acknowledgeTrialEnded = useCallback(async () => {
    const endsAt = entitlements?.trial_ends_at ?? '';
    setTrialJustEnded(false);
    try {
      await AsyncStorage.setItem(`${ACK_KEY_PREFIX}:${userId ?? 'anon'}:${endsAt}`, '1');
    } catch {
      // A failed write only means the notice may appear once more on a later
      // launch. Not worth surfacing, and not worth blocking the dismissal for.
    }
  }, [entitlements?.trial_ends_at, userId]);

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

  // Coming back to the app is when a trial has most likely lapsed unnoticed —
  // the effects above only re-run when the signed-in user changes, so without
  // this an app resumed after the trial ended would keep rendering the stale
  // `is_active` it loaded days ago.
  useEffect(() => {
    if (!user) return undefined;

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return;
      if (Date.now() - lastRefreshRef.current < FOREGROUND_REFRESH_MS) return;
      refresh();
    });

    return () => subscription.remove();
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
    () => ({
      entitlements,
      loading,
      error,
      isStale,
      realtimeStatus,
      trialJustEnded,
      acknowledgeTrialEnded,
      refresh,
      gates,
    }),
    [
      entitlements,
      loading,
      error,
      isStale,
      realtimeStatus,
      trialJustEnded,
      acknowledgeTrialEnded,
      refresh,
      gates,
    ]
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
