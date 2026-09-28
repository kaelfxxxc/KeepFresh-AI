// Food waste & savings report.
//
// The figures come from `wasteReportService`, which reads the `price` stored on
// each item, so every number here is money that actually left the household:
// what was binned, what was eaten, and the share of each.
//
// Two tiers, matching the entitlement matrix:
//   * everyone with `waste_report` gets totals, waste rate, category breakdown
//     and the biggest losses;
//   * `advanced_waste_report` adds why things were binned, the per-period
//     average and a yearly projection.
//
// The gate is checked up front and the reason is shown, rather than rendering an
// empty report a free-trial user cannot act on.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { Wallet, PiggyBank, TrendingDown, PackageX, CalendarClock, PieChart } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow, statusSurface } from '../src/theme';
import { NavHeader, Segmented, StatusBadge, UpgradeNotice, FeatureLock, PlanCheckLock, DonutProgress, StatCard, AIBanner, ProgressBar, SectionHeader, StatusPill, colorWithOpacity, IconBadge } from '../src/components/ui';
import { wasteReportService } from '../src/services/wasteReportService';
import { usePageGutter } from '../src/hooks/useContentLayout';
import type { ReportWindow, WasteReport } from '../src/types';

const peso = (n: number) => `₱${Math.round(n).toLocaleString()}`;

const WINDOW_LABEL: Record<ReportWindow, string> = {
  daily: 'Today',
  weekly: 'Last 7 days',
  monthly: 'This month',
  yearly: 'This year',
};

export default function AnalyticsScreen() {
  const { profile } = useAuth();
  const { gates, entitlements, loading: planLoading, error: planError, refresh: refreshPlan } = useSubscription();

  // Every block on this screen used to carry its own `marginHorizontal`, which
  // meant the gutter was written out eight times — and the Segmented control at
  // the top had already drifted to a narrower one than the cards under it. The
  // scroll view pads instead, so the column is defined once and centred as a
  // whole once it hits the content cap.
  const { gutter } = usePageGutter();

  const [range, setRange] = useState<ReportWindow>('monthly');
  const [report, setReport] = useState<WasteReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advanced = gates.advancedWasteReport.allowed;
  const canView = gates.wasteReport.allowed;

  const load = useCallback(async () => {
    if (!profile || !canView) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setReport(await wasteReportService.getReport(profile.id, range, advanced));
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not build the report.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, range, advanced, canView]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // See Price Tracking: with no entitlements the gates answer "allowed" for
  // everything, so the report must not render on a snapshot we do not have.
  if (!entitlements) {
    return (
      <View style={styles.container}>
        <NavHeader title="Reports" subtitle="Food waste & savings" />
        <PlanCheckLock loading={planLoading} error={planError} onRetry={refreshPlan} />
      </View>
    );
  }

  if (!canView) {
    return (
      <View style={styles.container}>
        <NavHeader title="Reports" subtitle="Food waste & savings" />
        <FeatureLock
          icon={PieChart}
          title="Waste & savings reports are a Premium feature"
          message="See exactly how much food — and money — you throw away, and what eating what you already have saves you."
          bullets={[
            'Money wasted, by category and by product',
            'Waste rate against what you actually ate',
            'Daily, weekly, monthly and yearly views',
            'Advanced plans add reason analysis and yearly projections',
          ]}
          ctaLabel="See plans"
          onPress={() => router.push('/subscription')}
        />
      </View>
    );
  }

  const trendMax = report ? Math.max(...report.trend.map((t) => t.value), 1) : 1;

  return (
    <View style={styles.container}>
      <NavHeader title="Reports" subtitle="Food waste & savings" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl, paddingHorizontal: gutter }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <View style={{ marginBottom: spacing.md }}>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { label: 'Day', value: 'daily' },
              { label: 'Week', value: 'weekly' },
              { label: 'Month', value: 'monthly' },
              { label: 'Year', value: 'yearly' },
            ]}
          />
        </View>

        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <Text style={styles.muted}>{error}</Text>
        ) : !report ? null : (
          <>
            {/* Donut + flanking stats */}
            <View style={styles.donutCard}>
              <DonutProgress percentage={report.savingsPercent} size={150} />

              <StatusPill status="fresh" label={WINDOW_LABEL[report.window]} style={{ marginTop: spacing.md }} />

              <View style={styles.flankRow}>
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: colors.primary }]} />
                  <Text style={styles.flankValue}>{report.itemsConsumed}</Text>
                  <Text style={styles.flankLabel}>items used</Text>
                </View>
                <View style={styles.flankSep} />
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: colors.danger }]} />
                  <Text style={styles.flankValue}>{report.itemsWasted}</Text>
                  <Text style={styles.flankLabel}>items wasted</Text>
                </View>
                <View style={styles.flankSep} />
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: colors.warning }]} />
                  <Text style={styles.flankValue}>{report.wastePercent}%</Text>
                  <Text style={styles.flankLabel}>waste rate</Text>
                </View>
              </View>
            </View>

            {/* AI Summary Banner */}
            <AIBanner
              index={1}
              icon="bulb"
              title="AI Waste Reduction Insight"
              body={
                report.wastePercent > 20
                  ? `Your waste rate is ${report.wastePercent}%. Try prioritizing meals with ${report.topProducts[0]?.name ?? 'expiring items'} to cut down losses.`
                  : `Outstanding job! You've used ${report.savingsPercent}% of your food and saved ${peso(report.estimatedSavings)}.`
              }
              variant={report.wastePercent > 20 ? 'mint' : 'dark'}
            />

            {/* The two money figures, stated plainly. */}
            <View style={styles.moneyRow}>
              <StatCard
                index={2}
                icon={TrendingDown}
                title="Wasted"
                value={peso(report.wastedValue)}
                iconBg={colors.danger}
              />
              <StatCard
                index={3}
                icon={PiggyBank}
                title="Saved by using it"
                value={peso(report.estimatedSavings)}
                iconBg={colors.primary}
              />
            </View>

            {/* Waste breakdown by category */}
            <SectionHeader title="Waste by category" />
            <View style={styles.card}>
              {report.byCategory.length === 0 ? (
                <Text style={styles.muted}>Nothing was thrown away in this period 🎉</Text>
              ) : (
                report.byCategory.map((row, index) => (
                  <View key={row.label} style={index === report.byCategory.length - 1 ? undefined : { marginBottom: 14 }}>
                    <View style={styles.barHead}>
                      <Text style={styles.barName}>
                        {row.label.charAt(0).toUpperCase() + row.label.slice(1)}
                        <Text style={styles.barCount}> · {row.count} items</Text>
                      </Text>
                      <Text style={styles.barValue}>{peso(row.value)}</Text>
                    </View>
                    <ProgressBar
                      value={row.value}
                      max={report.byCategory[0]?.value || 1}
                      colorRamp={false}
                      color={colors.warning}
                      height={8}
                      style={{ marginTop: 6 }}
                    />
                  </View>
                ))
              )}
            </View>

            {/* Biggest individual losses */}
            {report.topProducts.length > 0 && (
              <>
                <SectionHeader title="Biggest losses" />
                <View style={styles.card}>
                  {report.topProducts.map((product, index) => (
                    <View
                      key={product.name}
                      style={[styles.productRow, index === report.topProducts.length - 1 && { borderBottomWidth: 0 }]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
                        <Text style={styles.productMeta}>
                          {product.count} time{product.count === 1 ? '' : 's'} binned
                        </Text>
                      </View>
                      <Text style={styles.productValue}>{peso(product.value)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Trend — plain Views rather than a chart library, so it renders
                identically offline and adds no dependency. */}
            <SectionHeader
              title={report.window === 'daily' ? 'Last 7 days' : report.window === 'weekly' ? 'Last 8 weeks' : report.window === 'monthly' ? 'Last 6 months' : 'This year'}
              rightComponent={<CalendarClock size={16} color={colors.textSecondary} strokeWidth={2} />}
             
            />
            <View style={styles.card}>
              <View style={styles.trendRow}>
                {report.trend.map((bucket) => (
                  <View key={bucket.label} style={styles.trendCol}>
                    <View style={styles.trendTrack}>
                      <View
                        style={[
                          styles.trendFill,
                          { height: `${Math.max((bucket.value / trendMax) * 100, bucket.value > 0 ? 6 : 2)}%` },
                          bucket.value === 0 && styles.trendFillEmpty,
                        ]}
                      />
                    </View>
                    <Text style={styles.trendLabel} numberOfLines={1}>{bucket.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ---- Advanced tier --------------------------------------------- */}
            {advanced ? (
              <>
                <SectionHeader
                  title="Why it was binned"
                  rightComponent={<StatusBadge label="Pro" tone="success" />}
                 
                />
                <View style={styles.card}>
                  {(report.byReason ?? []).length === 0 ? (
                    <Text style={styles.muted}>No reasons recorded yet — they are captured when you mark an item as waste.</Text>
                  ) : (
                    (report.byReason ?? []).map((row, index) => (
                      <View key={row.label} style={index === (report.byReason ?? []).length - 1 ? undefined : { marginBottom: 12 }}>
                        <View style={styles.barHead}>
                          <Text style={styles.barName}>{row.label}</Text>
                          <Text style={styles.barValue}>{peso(row.value)}</Text>
                        </View>
                        <View style={styles.track}>
                          <View
                            style={[
                              styles.fill,
                              { width: `${(row.value / ((report.byReason ?? [])[0]?.value || 1)) * 100}%` },
                            ]}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>

                {report.projectedYearlyWaste != null && (
                  <View style={styles.projectionCard}>
                    <View style={styles.savingsIcon}>
                      <Wallet size={22} color={colors.primaryDark} strokeWidth={2.1} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savingsAmount}>{peso(report.projectedYearlyWaste)}</Text>
                      <Text style={styles.savingsLabel}>
                        Projected yearly waste at {peso(report.averagePerBucket ?? 0)} per period
                      </Text>
                    </View>
                  </View>
                )}
              </>
            ) : (
              <UpgradeNotice
                title="Advanced analytics are a Pro feature"
                message="See why items go to waste, the average per period, and a yearly projection of what the habit costs."
                ctaLabel="See Pro"
                onPress={() => router.push('/subscription')}
                style={{ marginTop: spacing.lg }}
              />
            )}

            {/* Savings, in the existing green card */}
            <View style={styles.savingsCard}>
              <View style={styles.savingsIcon}><PiggyBank size={22} color={colors.primaryDark} strokeWidth={2.1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.savingsAmount}>{peso(report.estimatedSavings)}</Text>
                <Text style={styles.savingsLabel}>Estimated value saved by eating what you had</Text>
              </View>
              <IconBadge color={colors.primaryDark} size={36}>
                <Wallet size={18} color={colors.primaryDark} strokeWidth={2} />
              </IconBadge>
            </View>

            <Text style={styles.footnote}>
              Figures use the price you recorded for each item. Items without a price count as ₱0,
              so adding prices makes this report sharper.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  loadingBox: { paddingVertical: spacing.xxl, alignItems: 'center' },

  donutCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  donutWrap: { alignItems: 'center', justifyContent: 'center' },
  donutCenter: { marginTop: 8, alignItems: 'center' },
  donutLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  flankRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, alignSelf: 'stretch' },
  flank: { flex: 1, alignItems: 'center' },
  flankDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 4 },
  flankValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  flankLabel: { fontSize: 11.5, color: colors.textSecondary },
  flankSep: { width: 1, height: 40, backgroundColor: colors.border },

  moneyRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  muted: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },

  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: 8 },
  barCount: { fontSize: 11.5, color: colors.textSecondary, fontWeight: '500' },
  barValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.mintBg, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },

  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  productName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  productMeta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  productValue: { fontSize: 14, fontWeight: '700', color: colors.danger },

  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 130 },
  trendCol: { flex: 1, alignItems: 'center', height: '100%' },
  trendTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  trendFill: { width: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  trendFillEmpty: { backgroundColor: colors.border },
  trendLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 5 },

  projectionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: spacing.lg,
    backgroundColor: statusSurface.warning.bg, borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: statusSurface.warning.border,
    ...shadow.card,
  },
  savingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: spacing.lg,
    backgroundColor: colors.mintBg, borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
  },
  savingsIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colorWithOpacity(colors.surface, 0.85), alignItems: 'center', justifyContent: 'center' },
  savingsAmount: { fontSize: 24, fontWeight: '800', color: colors.primaryDark },
  savingsLabel: { fontSize: 12, color: colors.primaryDark, marginTop: 1, opacity: 0.85 },

  footnote: {
    fontSize: 11.5, color: colors.textSecondary, lineHeight: 16,
    marginTop: spacing.lg,
  },
});
