import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../src/theme';
import Svg, { Circle } from 'react-native-svg';
import { Wallet, PiggyBank } from 'lucide-react-native';
import { NavHeader, Segmented, StatusBadge } from '../src/components/ui';

type TimeFilter = 'week' | 'month' | 'year';
const peso = (n: number) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function AnalyticsScreen() {
  const { profile } = useAuth();
  const [range, setRange] = useState<TimeFilter>('month');
  const [data, setData] = useState<{
    used: number; wasted: number; usedPct: number;
    consumptionValue: number; wasteValue: number;
    breakdown: { category: string; value: number }[];
  }>({ used: 0, wasted: 0, usedPct: 0, consumptionValue: 0, wasteValue: 0, breakdown: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const rangeStart = useCallback((): Date => {
    const now = new Date();
    if (range === 'week') { now.setDate(now.getDate() - 7); return now; }
    if (range === 'year') { now.setMonth(now.getMonth() - 11); now.setDate(1); return now; }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [range]);

  const fetchAnalytics = useCallback(async () => {
    if (!profile) return;
    try {
      setLoading(true);
      const start = rangeStart().toISOString();

      const { data: items } = await supabase.from('inventory_items').select('id, status, price, category').eq('user_id', profile.id);
      const idToCat: Record<string, string | null> = {};
      (items || []).forEach((i) => { idToCat[i.id] = i.category ?? null; });

      const used = items?.filter((i) => i.status === 'consumed').length || 0;
      const wasted = items?.filter((i) => i.status === 'wasted').length || 0;
      const usedPct = used + wasted > 0 ? Math.round((used / (used + wasted)) * 100) : 100;

      const [{ data: consumptions }, { data: waste }] = await Promise.all([
        supabase.from('inventory_consumption').select('quantity, inventory_item_id').eq('user_id', profile.id).gte('consumed_at', start),
        supabase.from('food_waste').select('quantity, estimated_value, inventory_item_id').eq('user_id', profile.id).gte('wasted_at', start),
      ]);

      const priceById: Record<string, number> = {};
      (items || []).forEach((i) => { if (i.price) priceById[i.id] = i.price; });

      const consumptionValue = (consumptions || []).reduce((s, c) => s + (priceById[c.inventory_item_id] || 0) * c.quantity, 0);
      const wasteValue = (waste || []).reduce((s, w) => s + (w.estimated_value || 0), 0);

      const byCat: Record<string, number> = {};
      (waste || []).forEach((w) => {
        const cat = idToCat[w.inventory_item_id] || 'Other';
        const pretty = cat.charAt(0).toUpperCase() + cat.slice(1);
        byCat[pretty] = (byCat[pretty] || 0) + (w.estimated_value || 0);
      });
      const breakdown = Object.entries(byCat)
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => b.value - a.value);

      setData({ used, wasted, usedPct, consumptionValue, wasteValue, breakdown });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, rangeStart]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const donutSize = 170;
  const stroke = 16;
  const r = (donutSize - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.min(Math.max(data.usedPct / 100, 0), 1);

  return (
    <View style={styles.container}>
      <NavHeader title="Analytics" subtitle="Your food usage at a glance" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACING.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAnalytics(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
      >
        <View style={{ paddingHorizontal: SPACING.lg, marginBottom: SPACING.md }}>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { label: 'Week', value: 'week' },
              { label: 'Month', value: 'month' },
              { label: 'Year', value: 'year' },
            ]}
          />
        </View>

        {loading ? null : (
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
                    strokeDasharray={`${C * frac} ${C}`}
                    transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                  />
                </Svg>
                <View style={styles.donutCenter}>
                  <Text style={styles.donutPct}>{data.usedPct}%</Text>
                  <Text style={styles.donutLabel}>Food Used</Text>
                </View>
              </View>
              <View style={styles.flankRow}>
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.flankValue}>{data.used}</Text>
                  <Text style={styles.flankLabel}>items used</Text>
                </View>
                <View style={styles.flankSep} />
                <View style={styles.flank}>
                  <View style={[styles.flankDot, { backgroundColor: COLORS.danger }]} />
                  <Text style={styles.flankValue}>{data.wasted}</Text>
                  <Text style={styles.flankLabel}>items wasted</Text>
                </View>
              </View>
            </View>

            {/* Waste breakdown */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Waste Breakdown</Text>
              <StatusBadge label={range === 'week' ? '7 days' : range === 'month' ? 'This month' : '12 months'} tone="neutral" />
            </View>
            <View style={styles.card}>
              {data.breakdown.length === 0 ? (
                <Text style={styles.muted}>No waste recorded in this period 🎉</Text>
              ) : data.breakdown.map((b) => {
                const max = data.breakdown[0].value || 1;
                return (
                  <View key={b.category} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={styles.catName}>{b.category}</Text>
                      <Text style={styles.catValue}>{peso(b.value)}</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${(b.value / max) * 100}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Savings */}
            <View style={styles.savingsCard}>
              <View style={styles.savingsIcon}><PiggyBank size={22} color={COLORS.primaryDark} strokeWidth={2.1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.savingsAmount}>{peso(data.consumptionValue)}</Text>
                <Text style={styles.savingsLabel}>Estimated value saved by eating what you had</Text>
              </View>
              <Wallet size={18} color={COLORS.primaryDark} strokeWidth={2} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
  flankValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  flankLabel: { fontSize: 12, color: COLORS.secondaryText },
  flankSep: { width: StyleSheet.hairlineWidth, height: 40, backgroundColor: COLORS.divider },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  card: { backgroundColor: COLORS.white, borderRadius: RADII.card, marginHorizontal: SPACING.lg, padding: SPACING.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider },
  muted: { color: COLORS.secondaryText, fontSize: 13 },
  catName: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  catValue: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  track: { height: 8, borderRadius: 4, backgroundColor: COLORS.primaryLight, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: COLORS.primary },
  savingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    backgroundColor: COLORS.greenGradientTop, borderRadius: RADII.card, padding: SPACING.lg,
  },
  savingsIcon: { width: 44, height: 44, borderRadius: RADII.icon, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  savingsAmount: { fontSize: 24, fontWeight: '800', color: COLORS.primaryDark },
  savingsLabel: { fontSize: 12, color: COLORS.primaryDark, marginTop: 1, opacity: 0.8 },
});
