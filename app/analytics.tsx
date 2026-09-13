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
import Svg, { Circle } from 'react-native-svg';
import { Wallet, PiggyBank, TrendingDown, PackageX, CalendarClock, PieChart } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { COLORS, SPACING, RADII } from '../src/theme';
import {
  NavHeader,
  Segmented,
  StatusBadge,
  Card,
  UpgradeNotice,
  FeatureLock,
} from '../src/components/ui';
import { wasteReportService } from '../src/services/wasteReportService';
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
  const { gates } = useSubscription();

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

  if (!canView && !loading) {
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

  const donutSize = 170;
  const stroke = 16;
  const r = (donutSize - stroke) / 2;
  const C = 2 * Math.PI * r;
  const usedFrac = report ? Math.min(Math.max(report.savingsPercent / 100, 0), 1) : 0;
  const trendMax = report ? Math.max(...report.trend.map((t) => t.value), 1) : 1;

  return (
    <View style={styles.container}>
      <NavHeader title="Reports" subtitle="Food waste & savings" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={{ paddingHorizontal: SPACING.lg, marginBottom: SPACING.md }}>
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
          <View style={styles.loadingBox}><ActivityIndicator color={COLORS.primary} /></View>
        ) : error ? (
          <Text style={[styles.muted, { paddingHorizontal: SPACING.lg }]}>{error}</Text>
        ) : !report ? null : (
          <>
            {/* Donut + flanking stats */}
            <View style={styles.donutCard}>
              <View style={styles.donutWrap}>
                <Svg width={donutSize} height={donutSize}>
                  <Circle cx={donutSize / 2} cy={donutSize / 2} r={r} stroke={COLORS.primaryLight} strokeWidth={stroke} fill="none" />
                  <Circle
                    cx={donutSize / 2} cy={donutSize / 2} r={r}
                    stroke={COLORS.secondary} strokeWidth={stroke} fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${C * usedFrac} ${C}`}
                    transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                  />
                </Svg>
                <View style={styles.donutCenter}>
                  <Text style={styles.donutPct}>{report.savingsPercent}%</Text>
                  <Text style={styles.donutLabel}>Food Used</Text>
                </View>
              </View>

              <StatusBadge label={WINDOW_LABEL[report.window]} tone="neutral" style={{ marginTop: SPACING.md }} />

              <View style={styles.flankRow}>
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.flankValue}>{report.itemsConsumed}</Text>
                  <Text style={styles.flankLabel}>items used</Text>
                </View>
                <View style={styles.flankSep} />
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: COLORS.danger }]} />
                  <Text style={styles.flankValue}>{report.itemsWasted}</Text>
                  <Text style={styles.flankLabel}>items wasted</Text>
                </View>
                <View style={styles.flankSep} />
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: COLORS.warning }]} />
                  <Text style={styles.flankValue}>{report.wastePercent}%</Text>
                  <Text style={styles.flankLabel}>waste rate</Text>
                </View>
              </View>
            </View>

            {/* The two money figures, stated plainly. */}
            <View style={styles.moneyRow}>
              <Card style={styles.moneyCard}>
                <View style={styles.moneyIcon}>
                  <TrendingDown size={18} color={COLORS.dangerText} strokeWidth={2.2} />
                </View>
                <Text style={styles.moneyValue}>{peso(report.wastedValue)}</Text>
                <Text style={styles.moneyLabel}>Wasted</Text>
              </Card>
              <Card style={styles.moneyCard}>
                <View style={[styles.moneyIcon, { backgroundColor: COLORS.successBg }]}>
                  <PiggyBank size={18} color={COLORS.successText} strokeWidth={2.2} />
                </View>
                <Text style={styles.moneyValue}>{peso(report.estimatedSavings)}</Text>
                <Text style={styles.moneyLabel}>Saved by using it</Text>
              </Card>
            </View>

            {/* Waste breakdown by category */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Waste by category</Text>
            </View>
            <View style={styles.card}>
              {report.byCategory.length === 0 ? (
                <Text style={styles.muted}>Nothing was thrown away in this period 🎉</Text>
              ) : (
                report.byCategory.map((row, index) => (
                  <View key={row.label} style={index === report.byCategory.length - 1 ? undefined : { marginBottom: 12 }}>
                    <View style={styles.barHead}>
                      <Text style={styles.barName}>
                        {row.label.charAt(0).toUpperCase() + row.label.slice(1)}
                        <Text style={styles.barCount}> · {row.count}</Text>
                      </Text>
                      <Text style={styles.barValue}>{peso(row.value)}</Text>
                    </View>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          { width: `${(row.value / (report.byCategory[0].value || 1)) * 100}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Biggest individual losses */}
            {report.topProducts.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Biggest losses</Text>
                  <PackageX size={16} color={COLORS.secondaryText} strokeWidth={2} />
                </View>
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
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {report.window === 'daily' ? 'Last 7 days' : report.window === 'weekly' ? 'Last 8 weeks' : report.window === 'monthly' ? 'Last 6 months' : 'This year'}
              </Text>
              <CalendarClock size={16} color={COLORS.secondaryText} strokeWidth={2} />
            </View>
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
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Why it was binned</Text>
                  <StatusBadge label="Pro" tone="success" />
                </View>
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
                      <Wallet size={22} color={COLORS.primaryDark} strokeWidth={2.1} />
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
                style={{ marginHorizontal: SPACING.lg, marginTop: SPACING.lg }}
              />
            )}

            {/* Savings, in the existing green card */}
            <View style={styles.savingsCard}>
              <View style={styles.savingsIcon}><PiggyBank size={22} color={COLORS.primaryDark} strokeWidth={2.1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.savingsAmount}>{peso(report.estimatedSavings)}</Text>
                <Text style={styles.savingsLabel}>Estimated value saved by eating what you had</Text>
              </View>
              <Wallet size={18} color={COLORS.primaryDark} strokeWidth={2} />
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
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { paddingVertical: SPACING.xxl, alignItems: 'center' },

  donutCard: {
    marginHorizontal: SPACING.lg, backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.lg, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  donutWrap: { alignItems: 'center', justifyContent: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontSize: 34, fontWeight: '800', color: COLORS.text },
  donutLabel: { fontSize: 12, color: COLORS.secondaryText, fontWeight: '600' },
  flankRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.lg, alignSelf: 'stretch' },
  flank: { flex: 1, alignItems: 'center' },
  flankDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 4 },
  flankValue: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  flankLabel: { fontSize: 11.5, color: COLORS.secondaryText },
  flankSep: { width: StyleSheet.hairlineWidth, height: 40, backgroundColor: COLORS.divider },

  moneyRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  moneyCard: { flex: 1, padding: SPACING.md, gap: 6 },
  moneyIcon: {
    width: 34, height: 34, borderRadius: RADII.icon,
    backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center',
  },
  moneyValue: { fontSize: 19, fontWeight: '800', color: COLORS.text },
  moneyLabel: { fontSize: 11.5, color: COLORS.secondaryText },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADII.card, marginHorizontal: SPACING.lg,
    padding: SPACING.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  muted: { color: COLORS.secondaryText, fontSize: 13, lineHeight: 18 },

  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barName: { fontSize: 13, fontWeight: '600', color: COLORS.text, flex: 1, marginRight: 8 },
  barCount: { fontSize: 11.5, color: COLORS.secondaryText, fontWeight: '500' },
  barValue: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  track: { height: 8, borderRadius: 4, backgroundColor: COLORS.primaryLight, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: COLORS.primary },

  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider,
  },
  productName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  productMeta: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: 1 },
  productValue: { fontSize: 14, fontWeight: '700', color: COLORS.dangerText },

  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 130 },
  trendCol: { flex: 1, alignItems: 'center', height: '100%' },
  trendTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  trendFill: { width: '100%', backgroundColor: COLORS.primary, borderRadius: 4 },
  trendFillEmpty: { backgroundColor: COLORS.divider },
  trendLabel: { fontSize: 9.5, color: COLORS.secondaryText, marginTop: 5 },

  projectionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    backgroundColor: COLORS.warningBg, borderRadius: RADII.card, padding: SPACING.lg,
  },
  savingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    backgroundColor: COLORS.greenGradientTop, borderRadius: RADII.card, padding: SPACING.lg,
  },
  savingsIcon: { width: 44, height: 44, borderRadius: RADII.icon, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  savingsAmount: { fontSize: 24, fontWeight: '800', color: COLORS.primaryDark },
  savingsLabel: { fontSize: 12, color: COLORS.primaryDark, marginTop: 1, opacity: 0.8 },

  footnote: {
    fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.lg,
  },
});
