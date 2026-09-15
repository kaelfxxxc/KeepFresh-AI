// Subscription & plans.
//
// Two halves:
//   * what you have now — plan, price, renewal date, and the two usage meters
//     the spec asks for ("75 / 100 products", "32 / 50 AI scans used");
//   * what you could move to — the full price list, both audiences, with the
//     monthly/yearly choice.
//
// Nothing on this screen activates a plan. "Choose" hands the store's receipt
// to the `subscription-verify` edge function; the server decides. When billing
// is not configured in the build, the button says so plainly instead of
// pretending to succeed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Crown,
  Check,
  X,
  Sparkles,
  CalendarClock,
  Package,
  ScanLine,
  RotateCcw,
  Info,
} from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { COLORS, RADII, SHADOW, SPACING } from '../src/theme';
import {
  NavHeader,
  Card,
  PillButton,
  Segmented,
  StatusBadge,
  UsageMeter,
  Divider,
} from '../src/components/ui';
import {
  subscriptionService,
  describeStatus,
  periodDaysRemaining,
  isTrialPlan,
  trialHasEnded,
  yearlySavingPercent,
  isPurchasable,
  storeProductId,
  type PlanGroup,
} from '../src/services/subscriptionService';
import { paymentService } from '../src/services/paymentService';
import type { BillingPeriod, FeatureEntitlement, SubscriptionPlan } from '../src/types';

type FeatureMatrix = Record<string, Record<string, FeatureEntitlement>>;

export default function SubscriptionScreen() {
  const { profile } = useAuth();
  const { entitlements, refresh } = useSubscription();
  const router = useRouter();

  const [groups, setGroups] = useState<PlanGroup[]>([]);
  const [matrix, setMatrix] = useState<FeatureMatrix>({});
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const billingReady = paymentService.isConfigured();

  const load = useCallback(async () => {
    try {
      const [nextGroups, nextMatrix] = await Promise.all([
        subscriptionService.getPlanGroups(),
        subscriptionService.getFeatureMatrix(),
      ]);
      setGroups(nextGroups);
      setMatrix(nextMatrix);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error)?.message ?? 'Could not load the price list.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Default the toggle to whatever the user is already paying for, so the
  // current plan reads as "selected" rather than as a mismatch.
  useEffect(() => {
    if (entitlements?.billing_period === 'yearly') setPeriod('yearly');
    else if (entitlements?.billing_period === 'monthly') setPeriod('monthly');
  }, [entitlements?.billing_period]);

  const status = describeStatus(entitlements);
  // Server-computed, so it is right regardless of the device clock or timezone.
  const daysLeft = periodDaysRemaining(entitlements);
  const onTrial = isTrialPlan(entitlements);
  const trialOver = trialHasEnded(entitlements);

  const currentPlanId = entitlements?.plan_id ?? null;
  const currentTier = entitlements?.tier ?? null;

  const periodOptions = useMemo(
    () => [
      { label: 'Monthly', value: 'monthly' as BillingPeriod },
      { label: 'Yearly', value: 'yearly' as BillingPeriod },
    ],
    []
  );

  /**
   * Only plans for this account's kind — a Household account sees Household
   * plans, a Food Establishment account sees Food Establishment plans.
   *
   * The account type is the filter, not the active plan: someone who signed up
   * as Household sees Household plans even while on a trial. `entitlements` is
   * only consulted when the profile has not loaded yet.
   *
   * The fallback matters — if the matching audience has no rows at all (an
   * unseeded or partially migrated database), showing nothing would look like a
   * billing failure. Showing the full list is wrong but visible, which is the
   * better failure.
   */
  const accountType = profile?.account_type ?? entitlements?.account_type ?? 'household';
  const visibleGroups = useMemo(() => {
    const matching = groups.filter((group) => group.audience === accountType);
    return matching.length > 0 ? matching : groups;
  }, [groups, accountType]);

  const audienceLabel = accountType === 'establishment' ? 'Food Establishment' : 'Household';

  const choosePlan = async (plan: SubscriptionPlan) => {
    if (plan.id === currentPlanId && entitlements?.is_active) {
      Alert.alert('Already active', `You are already on ${plan.name}.`);
      return;
    }

    setBusyPlanId(plan.id);
    try {
      const outcome = await paymentService.purchase({
        planId: plan.id,
        productId: storeProductId(plan),
        period: plan.billing_period,
      });

      if (outcome.status === 'activated') {
        await refresh();
        Alert.alert('You are all set', `${plan.name} is now active.`);
      } else if (outcome.status === 'cancelled') {
        // Backing out of a store sheet is not an error worth an alert.
      } else {
        Alert.alert(
          outcome.status === 'unavailable' ? 'Not available yet' : 'Could not complete',
          outcome.message
        );
      }
    } finally {
      setBusyPlanId(null);
    }
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const outcome = await paymentService.restore();
      if (outcome.status === 'activated') {
        await refresh();
        Alert.alert('Restored', 'Your subscription is active again.');
      } else {
        Alert.alert('Nothing to restore', outcome.message);
      }
    } finally {
      setRestoring(false);
    }
  };

  const toggleCancellation = () => {
    if (!entitlements) return;

    if (entitlements.cancel_at_period_end) {
      Alert.alert('Keep your plan?', 'Renewal will continue as normal.', [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Keep plan',
          onPress: async () => {
            try {
              await subscriptionService.resumeMySubscription();
              await refresh();
            } catch (e) {
              Alert.alert('Could not update', (e as Error).message);
            }
          },
        },
      ]);
      return;
    }

    Alert.alert(
      'Turn off renewal?',
      // The reassurance matters: people avoid cancelling because they fear
      // losing their data.
      `You keep every feature until ${formatDate(entitlements.current_period_end)}. Your inventory, storage areas and history are never deleted.`,
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Turn off renewal',
          style: 'destructive',
          onPress: async () => {
            try {
              await subscriptionService.cancelMySubscription(true);
              await refresh();
            } catch (e) {
              Alert.alert('Could not update', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <NavHeader
        title="Subscription"
        subtitle={entitlements?.plan_name ?? 'Plans & billing'}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              refresh();
              load();
            }}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* ------------------------------------------------ Current plan */}
        <Card style={styles.currentCard}>
          <View style={styles.currentTop}>
            <View style={styles.crownWrap}>
              <Crown size={20} color={COLORS.primary} strokeWidth={2.3} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.currentName} numberOfLines={1}>
                {entitlements?.plan_name ?? 'Loading your plan…'}
              </Text>
              <Text style={styles.currentPrice}>
                {entitlements
                  ? `${formatMoney(entitlements.price_php)} · ${periodLabelFor(entitlements.billing_period)}`
                  : '—'}
              </Text>
            </View>
            <StatusBadge label={status.label} tone={status.tone} />
          </View>

          {!!entitlements?.current_period_end && (
            <View style={styles.renewRow}>
              <CalendarClock size={15} color={COLORS.secondaryText} strokeWidth={2} />
              <Text style={styles.renewText}>
                {/* `is_active` first: a lapsed plan used to fall through to the
                    "Renews …" wording below, which told an expired user their
                    plan was about to renew. */}
                {entitlements.is_active === false
                  ? `Ended ${formatDate(entitlements.current_period_end)}`
                  : entitlements.cancel_at_period_end
                    ? `Access ends ${formatDate(entitlements.current_period_end)}`
                    : onTrial
                      ? `Trial ends ${formatDate(entitlements.current_period_end)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
                      : `Renews ${formatDate(entitlements.current_period_end)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
              </Text>
            </View>
          )}

          {entitlements?.is_active === false && (
            <View style={styles.lapsed}>
              <Info size={15} color={COLORS.warningText} strokeWidth={2.2} />
              <Text style={styles.lapsedText}>
                {trialOver
                  ? `Your free trial${
                      entitlements.trial_ends_at
                        ? ` ended on ${formatDate(entitlements.trial_ends_at)}`
                        : ' has ended'
                    }. Your account is back on the free plan, so premium features are paused. Nothing was deleted — your inventory, storage areas and history are all still here.`
                  : 'Your plan has ended, so premium features are paused. Nothing was deleted — your inventory, storage areas and history are all still here.'}
              </Text>
            </View>
          )}

          <Divider />

          {/* Usage — the two counters the spec calls for, in its wording. */}
          <UsageMeter
            label="Products"
            used={entitlements?.products_used ?? 0}
            limit={entitlements?.max_products ?? 0}
          />
          <UsageMeter
            label="AI scans this month"
            used={entitlements?.ai_scans_used ?? 0}
            limit={entitlements?.max_ai_scans ?? 0}
            style={{ marginTop: SPACING.md }}
          />

          {(entitlements?.products_used ?? 0) >= (entitlements?.max_products ?? Infinity) && (
            <View style={styles.limitHit}>
              <Text style={styles.limitHitText}>
                You have reached your product limit. Upgrade below to add more — existing items are
                untouched.
              </Text>
            </View>
          )}
          {(entitlements?.ai_scans_used ?? 0) >= (entitlements?.max_ai_scans ?? Infinity) && (
            <View style={styles.limitHit}>
              <Text style={styles.limitHitText}>
                You have used every AI scan for this month. Your allowance resets on the 1st.
              </Text>
            </View>
          )}

          {/* What this plan includes, straight from the entitlement matrix. */}
          <Text style={styles.includesLabel}>Included in your plan</Text>
          <View style={styles.featureWrap}>
            {subscriptionService
              .describeFeatures(entitlements?.features)
              .map((feature) => (
                <View key={feature.key} style={styles.featureChip}>
                  <Check size={12} color={COLORS.primary} strokeWidth={3} />
                  <Text style={styles.featureChipText}>
                    {feature.label}
                    {feature.limit != null && feature.limit > 1 ? ` (${feature.limit})` : ''}
                  </Text>
                </View>
              ))}
            {!entitlements?.features && (
              <Text style={styles.mutedNote}>Loading…</Text>
            )}
          </View>

          <View style={styles.currentActions}>
            {entitlements?.is_active && (
              <PillButton
                title={entitlements.cancel_at_period_end ? 'Resume renewal' : 'Turn off renewal'}
                variant="outline"
                icon={entitlements.cancel_at_period_end ? RotateCcw : X}
                onPress={toggleCancellation}
                style={{ flex: 1 }}
              />
            )}
            <PillButton
              title="Restore purchases"
              variant="subtle"
              onPress={restore}
              loading={restoring}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        {/* --------------------------------------------------- Plan list */}
        <View style={styles.sectionHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{audienceLabel} plans</Text>
            <Text style={styles.sectionSub}>
              These are the plans for your {audienceLabel} account. Pick the capacity you need.
            </Text>
          </View>
        </View>

        <Segmented options={periodOptions} value={period} onChange={setPeriod} />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : loadError ? (
          <Text style={styles.errorText}>{loadError}</Text>
        ) : (
          visibleGroups.map((group) => (
            <View key={group.audience} style={{ marginTop: SPACING.lg }}>
              {group.tiers.map((tier) => (
                <PlanCard
                  key={`${group.audience}-${tier.tier}`}
                  tierLabel={tier.tierLabel}
                  monthly={tier.monthly}
                  yearly={tier.yearly}
                  period={period}
                  matrix={matrix}
                  currentPlanId={currentPlanId}
                  currentTier={currentTier}
                  isActive={!!entitlements?.is_active}
                  busyPlanId={busyPlanId}
                  billingReady={billingReady}
                  onChoose={choosePlan}
                />
              ))}
            </View>
          ))
        )}

        {/* ------------------------------------------------ Fine print */}
        <View style={styles.finePrint}>
          <Info size={14} color={COLORS.secondaryText} strokeWidth={2} />
          <Text style={styles.finePrintText}>
            {billingReady
              ? 'Purchases are verified on our server before a plan is activated. Cancel any time — turning off renewal never deletes your data.'
              : 'In-app billing is not enabled in this build, so plans cannot be purchased from here yet. Purchase verification runs on our server; nothing is activated locally.'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------ Plan card */

function PlanCard({
  tierLabel,
  monthly,
  yearly,
  period,
  matrix,
  currentPlanId,
  currentTier,
  isActive,
  busyPlanId,
  billingReady,
  onChoose,
}: {
  tierLabel: string;
  monthly: SubscriptionPlan | null;
  yearly: SubscriptionPlan | null;
  period: BillingPeriod;
  matrix: FeatureMatrix;
  currentPlanId: string | null;
  currentTier: string | null;
  isActive: boolean;
  busyPlanId: string | null;
  billingReady: boolean;
  onChoose: (plan: SubscriptionPlan) => void;
}) {
  // The plan this tier's toggle resolves to, falling back to whichever period
  // exists so a tier that is only sold yearly still renders.
  const plan = period === 'yearly' ? yearly ?? monthly : monthly ?? yearly;
  if (!plan) return null;

  const isTrial = plan.tier === 'free_trial';
  const isCurrent = plan.id === currentPlanId && isActive;
  // Same tier, different audience: still an upgrade/downgrade worth offering.
  const sameTier = plan.tier === currentTier && !isCurrent;

  const features = matrix[plan.id];
  const featured = plan.tier === 'pro';
  const saving = yearlySavingPercent(monthly, yearly);

  const priceLabel = isTrial
    ? 'Free'
    : `${formatMoney(plan.price_php)}${period === 'yearly' ? '/year' : '/month'}`;

  const subLabel = isTrial
    ? `${plan.duration_days} days`
    : period === 'yearly' && saving
      ? `Save ${saving}% vs monthly`
      : `${plan.duration_days} days`;

  const canBuy = isPurchasable(plan);

  return (
    <Card style={[styles.planCard, featured && styles.planCardFeatured]}>
      <View style={styles.planHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.planTitleRow}>
            <Text style={styles.planTier} numberOfLines={1}>{tierLabel}</Text>
            {featured && <StatusBadge label="Best value" tone="success" icon={Sparkles} />}
          </View>
          <Text style={styles.planPrice}>{priceLabel}</Text>
          <Text style={styles.planSub}>{subLabel}</Text>
        </View>
        {isCurrent && <StatusBadge label="Current" tone="success" icon={Check} />}
      </View>

      <View style={styles.planLimits}>
        <View style={styles.planLimit}>
          <Package size={14} color={COLORS.primary} strokeWidth={2.2} />
          <Text style={styles.planLimitText}>{plan.max_products} products</Text>
        </View>
        <View style={styles.planLimit}>
          <ScanLine size={14} color={COLORS.primary} strokeWidth={2.2} />
          <Text style={styles.planLimitText}>{plan.max_ai_scans} AI scans / month</Text>
        </View>
      </View>

      {features && (
        <View style={styles.planFeatures}>
          {subscriptionService.describeFeatures(features).map((feature) => (
            <View key={feature.key} style={styles.planFeatureRow}>
              <Check size={14} color={COLORS.primary} strokeWidth={2.6} />
              <Text style={styles.planFeatureText}>
                {feature.label}
                {feature.limit != null && feature.limit > 1 ? ` — up to ${feature.limit}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {isCurrent ? (
        <View style={styles.currentTag}>
          <Text style={styles.currentTagText}>Your current plan</Text>
        </View>
      ) : isTrial && isActive ? (
        // A free trial is granted by signup, never bought — offering a button
        // that cannot work would be the "placeholder button" the spec forbids.
        <Text style={styles.trialNote}>
          Free trials start automatically when you create an account.
        </Text>
      ) : (
        <PillButton
          title={
            !canBuy
              ? 'Contact support'
              : sameTier
                ? 'Switch to this plan'
                : currentTier === 'pro' && plan.tier !== 'pro'
                  ? 'Change plan'
                  : 'Choose plan'
          }
          variant={featured ? 'primary' : 'outline'}
          loading={busyPlanId === plan.id}
          disabled={!canBuy || busyPlanId !== null || !billingReady}
          onPress={() => onChoose(plan)}
          style={{ marginTop: SPACING.md }}
        />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- helpers */

function formatMoney(value: number): string {
  return `₱${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function periodLabelFor(period: BillingPeriod): string {
  return period === 'yearly' ? 'per year' : period === 'monthly' ? 'per month' : 'free trial';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  currentCard: { padding: SPACING.lg },
  currentTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  crownWrap: {
    width: 42,
    height: 42,
    borderRadius: RADII.icon,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentName: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  currentPrice: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  renewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SPACING.md },
  renewText: { fontSize: 12.5, color: COLORS.secondaryText, flex: 1 },
  lapsed: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.warningBg,
    borderRadius: RADII.card,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  lapsedText: { flex: 1, fontSize: 12.5, color: COLORS.warningText, lineHeight: 17 },

  limitHit: {
    backgroundColor: COLORS.dangerBg,
    borderRadius: RADII.card,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  limitHitText: { fontSize: 12.5, color: COLORS.dangerText, lineHeight: 17 },

  includesLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  featureWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
  },
  featureChipText: { fontSize: 11.5, fontWeight: '600', color: COLORS.primaryDark },
  mutedNote: { fontSize: 12, color: COLORS.secondaryText },

  currentActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', marginTop: SPACING.xl, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  sectionSub: { fontSize: 12.5, color: COLORS.secondaryText, marginTop: 3, lineHeight: 17 },

  loadingBox: { paddingVertical: SPACING.xl, alignItems: 'center' },
  errorText: { fontSize: 13, color: COLORS.dangerText, marginTop: SPACING.md },

  planCard: { padding: SPACING.lg, marginTop: SPACING.sm },
  planCardFeatured: { borderColor: COLORS.primary, borderWidth: 1.5 },
  planHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planTier: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  planPrice: { fontSize: 24, fontWeight: '800', color: COLORS.primary, marginTop: 6 },
  planSub: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },

  planLimits: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: SPACING.md },
  planLimit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planLimitText: { fontSize: 13, fontWeight: '600', color: COLORS.text },

  planFeatures: { marginTop: SPACING.md, gap: 8 },
  planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planFeatureText: { flex: 1, fontSize: 13, color: COLORS.text },

  currentTag: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADII.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  currentTagText: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  trialNote: { fontSize: 12, color: COLORS.secondaryText, marginTop: SPACING.md, lineHeight: 17 },

  finePrint: { flexDirection: 'row', gap: 8, marginTop: SPACING.xl, paddingHorizontal: 2 },
  finePrintText: { flex: 1, fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16 },
});
