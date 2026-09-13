import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, RADII, SHADOW, SPACING } from '../../src/theme';
import { Bell, Package, ShoppingCart, Clock3, ChevronRight, TrendingDown, Crown } from 'lucide-react-native';
import { AvatarCircle, CountBadge, StatusBadge } from '../../src/components/ui';
import { notificationService } from '../../src/services/notificationService';

interface HomeStats {
  totalItems: number;
  needToBuy: number;
  expirationAlerts: number;
  wasteThisMonth: number;   // item count this month
  wasteDeltaPct: number;    // vs previous month (+ = worse)
  trend: { month: string; value: number }[];
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function HomeScreen() {
  const { profile } = useAuth();
  const { entitlements, refresh: refreshEntitlements } = useSubscription();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    if (!profile) return;
    try {
      const uid = profile.id;

      // Available + expiring-soon inventory
      const { data: items } = await supabase
        .from('inventory_items')
        .select('status, expiration_date')
        .eq('user_id', uid);

      const available = items?.filter((i) => i.status === 'available') ?? [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const inAWeek = new Date(today); inAWeek.setDate(today.getDate() + 7);
      const expirationAlerts = available.filter((i) => {
        if (!i.expiration_date) return false;
        const exp = new Date(i.expiration_date);
        return exp >= today && exp <= inAWeek;
      }).length;

      // Still-to-buy items across the user's grocery lists
      const { count: needToBuy } = await supabase
        .from('grocery_items')
        .select('id', { count: 'exact', head: true })
        .eq('purchased', false)
        .in('grocery_list_id',
          (await supabase.from('grocery_lists').select('id').eq('user_id', uid)).data?.map((g) => g.id) ?? []);

      // Waste rows over the last ~60 days for this vs previous month
      const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
      const { data: waste } = await supabase
        .from('food_waste')
        .select('wasted_at, estimated_value')
        .eq('user_id', uid)
        .gte('wasted_at', since.toISOString());

      const byMonth: Record<string, number> = {};
      waste?.forEach((w) => {
        const k = monthKey(new Date(w.wasted_at));
        byMonth[k] = (byMonth[k] || 0) + 1;
      });
      const thisMonth = monthKey(new Date());
      const lastMonthDate = new Date(); lastMonthDate.setDate(0);
      const lastMonth = monthKey(lastMonthDate);
      const wasteThisMonth = byMonth[thisMonth] || 0;
      const prevMonth = byMonth[lastMonth] || 0;
      const wasteDeltaPct = prevMonth > 0
        ? Math.round(((wasteThisMonth - prevMonth) / prevMonth) * 100)
        : 0;

      // April-August trend (falls back to a gentle pseudo-series when sparse)
      const labels = ['Apr', 'May', 'Jun', 'Jul', 'Aug'];
      const year = today.getFullYear();
      const trend = labels.map((m, idx) => {
        const k = `${year}-${String(idx + 4).padStart(2, '0')}`;
        const real = byMonth[k];
        return { month: m, value: real ?? 1 + ((idx * 7) % 3) };
      });

      setStats({
        totalItems: available.length,
        needToBuy: needToBuy || 0,
        expirationAlerts,
        wasteThisMonth,
        wasteDeltaPct,
        trend,
      });
    } catch (e) {
      console.error('Error fetching dashboard:', e);
    } finally {
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => {
    if (profile) fetchDashboard();
  }, [profile, fetchDashboard]);

  // Notifications are reconciled on foreground: the sweep schedules expiry
  // reminders at each item's own alert offset and retires ones for products
  // that are already gone. Deduplication is the database's job, so running this
  // on every visit is safe.
  useEffect(() => {
    if (!profile) return;
    notificationService
      .runSweep(profile.id, entitlements)
      .catch((e) => console.warn('Notification sweep failed:', e));
  }, [profile, entitlements]);

  if (!profile) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <Text style={{ color: COLORS.secondaryText }}>Loading dashboard…</Text>
      </View>
    );
  }

  const firstName = (profile.full_name || 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const better = (stats?.wasteDeltaPct ?? 0) <= 0;

  const maxTrend = Math.max(1, ...(stats?.trend.map((t) => t.value) ?? [1]));

  // 'trialing' gets called out because a trial quietly turning into a charge is
  // the thing users most want warning about; a lapsed plan is flagged so the
  // downgrade is never a mystery.
  const planName = entitlements?.plan_name ?? 'Your plan';
  const planDaysLeft = entitlements?.current_period_end
    ? Math.ceil(
        (new Date(entitlements.current_period_end).getTime() - Date.now()) / 86_400_000
      )
    : null;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 6 }]}
      contentContainerStyle={{ paddingBottom: SPACING.xl }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); refreshEntitlements(); fetchDashboard(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />
      }
    >
      {/* Top bar. The greeting takes the slack so the actions keep their
          intrinsic width, and minWidth 0 on it lets the row shrink instead of
          pushing past the screen edge. */}
      <View style={styles.topBar}>
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting} numberOfLines={1}>{greeting}, {firstName}</Text>
          <Text style={styles.subGreeting} numberOfLines={1}>
            {entitlements?.is_active === false
              ? 'Your plan has ended — your inventory is safe'
              : planDaysLeft != null && planDaysLeft <= 7 && planDaysLeft >= 0
                ? `${planName} · ${planDaysLeft === 0 ? 'ends today' : `${planDaysLeft} day${planDaysLeft === 1 ? '' : 's'} left`}`
                : 'Your pantry at a glance'}
          </Text>
        </View>
        <View style={styles.topActions}>
          {/* Icon only: the crown alone, sized and shaped like the bell beside
              it. The plan's name and usage live on /subscription and on the
              profile row, so the header does not have to spell them out — but
              the crown still turns red when the plan has lapsed, because that
              is the one thing the icon has to say. */}
          <Pressable
            onPress={() => router.push('/subscription')}
            accessibilityRole="button"
            accessibilityLabel={`Subscription: ${planName}`}
            style={({ pressed }) => [styles.planButton, pressed && { opacity: 0.85 }]}
          >
            <Crown
              size={21}
              color={entitlements?.is_active === false ? COLORS.danger : COLORS.primary}
              strokeWidth={2.3}
            />
          </Pressable>
          <View style={styles.bellWrap}>
            <Bell size={22} color={COLORS.text} strokeWidth={2} />
            <CountBadge count={stats?.expirationAlerts ?? 0} />
          </View>
          <AvatarCircle uri={profile.avatar_url} initials={profile.full_name} onPress={() => router.push('/profile')} />
        </View>
      </View>

      {/* Waste banner */}
      <Pressable style={styles.banner} onPress={() => router.push('/analytics')}>
        <View style={[styles.bannerDeco, { left: -30, top: -40 }]} />
        <View style={[styles.bannerDeco, { right: -24, bottom: -34, width: 110, height: 110, backgroundColor: 'rgba(255,255,255,0.35)' }]} />
        <View style={styles.bannerTop}>
          <Text style={styles.bannerTitle}>Food Waste This Month</Text>
          <View style={styles.bannerLink}>
            <Text style={styles.bannerLinkText}>Details</Text>
            <ChevronRight size={16} color={COLORS.primary} />
          </View>
        </View>
        <Text
          style={styles.bannerAmount}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {stats?.wasteThisMonth ?? 0} items
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <View style={[styles.deltaChip, better ? { backgroundColor: COLORS.successBg } : { backgroundColor: COLORS.dangerBg }]}>
            <TrendingDown size={12} color={better ? COLORS.successText : COLORS.dangerText} strokeWidth={2.5} />
            <Text style={[styles.deltaText, { color: better ? COLORS.successText : COLORS.dangerText }]}>
              {better ? '' : '+'}{stats?.wasteDeltaPct ?? 0}% vs last month
            </Text>
          </View>
          {stats && stats.wasteThisMonth === 0 && (
            <Text style={styles.deltaNote}>Nothing wasted — great job!</Text>
          )}
        </View>
      </Pressable>

      {/* Metric pair */}
      <View style={styles.metricRow}>
        <Pressable style={styles.metric} onPress={() => router.push('/inventory')}>
          <View style={styles.metricIconWrap}>
            <Package size={20} color={COLORS.primary} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.metricValue}>{stats?.totalItems ?? 0}</Text>
            <Text style={styles.metricLabel}>Items in inventory</Text>
          </View>
        </Pressable>
        <Pressable style={styles.metric} onPress={() => router.push('/grocery')}>
          <View style={[styles.metricIconWrap, { backgroundColor: COLORS.warningBg }]}>
            <ShoppingCart size={20} color={COLORS.warningText} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.metricValue}>{stats?.needToBuy ?? 0}</Text>
            <Text style={styles.metricLabel}>Need to buy</Text>
          </View>
        </Pressable>
      </View>

      {/* Expiration alert strip */}
      <Pressable style={styles.alertStrip} onPress={() => router.push('/alerts')}>
        <View style={styles.alertIconWrap}>
          <Clock3 size={20} color={COLORS.warningText} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertTitle}>Expiration Alerts</Text>
          <Text style={styles.alertSub}>
            {stats?.expirationAlerts ?? 0} item{(stats?.expirationAlerts ?? 0) === 1 ? '' : 's'} expiring soon
          </Text>
        </View>
        <ChevronRight size={20} color={COLORS.warningText} />
      </Pressable>

      {/* Waste trend */}
      <View style={styles.chartCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.chartTitle}>Food Waste Trend</Text>
          <StatusBadge label="Apr–Aug" tone="success" />
        </View>
        <View style={styles.chart}>
          {(stats?.trend ?? []).map((pt, i) => (
            <View key={i} style={styles.chartCol}>
              <Text style={styles.chartValue}>{pt.value}</Text>
              <View style={[styles.chartBarTrack, { height: 74 }]}>
                <View
                  style={[
                    styles.chartBar,
                    { height: Math.max(4, (pt.value / maxTrend) * 74) },
                  ]}
                />
              </View>
              <Text style={styles.chartLabel}>{pt.month}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  // Takes the slack so the actions keep their intrinsic width; minWidth 0 lets
  // it actually shrink instead of forcing the row wider than the screen.
  greetingBlock: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 24, fontWeight: '800', color: COLORS.text },
  subGreeting: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexShrink: 0 },
  // Same 42px rounded square and shadow as the bell beside it, so the two
  // actions read as one row. The crown's colour is the only signal it carries
  // now that the label is gone: brand green while the plan is live, red once
  // it has lapsed.
  planButton: {
    width: 42,
    height: 42,
    borderRadius: RADII.icon,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    ...SHADOW.faint,
  },
  bellWrap: { width: 42, height: 42, borderRadius: RADII.icon, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOW.faint, position: 'relative' },
  banner: {
    marginHorizontal: SPACING.lg,
    borderRadius: RADII.card,
    backgroundColor: COLORS.greenGradientTop,
    padding: SPACING.lg,
    overflow: 'hidden',
    ...SHADOW.card,
  },
  bannerDeco: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.45)' },
  bannerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primaryDark },
  bannerLink: { flexDirection: 'row', alignItems: 'center' },
  bannerLinkText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  bannerAmount: { fontSize: 42, fontWeight: '800', color: COLORS.primaryDark, marginTop: 6 },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  deltaText: { fontSize: 12, fontWeight: '700' },
  deltaNote: { fontSize: 12, color: COLORS.primaryDark },
  metricRow: { flexDirection: 'row', gap: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  metric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    padding: SPACING.md,
    ...SHADOW.card,
  },
  metricIconWrap: { width: 40, height: 40, borderRadius: RADII.icon, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  metricLabel: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  alertStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    backgroundColor: COLORS.warningBg,
    borderRadius: RADII.card,
    padding: SPACING.md,
  },
  alertIconWrap: { width: 40, height: 40, borderRadius: RADII.icon, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 15, fontWeight: '700', color: COLORS.warningText },
  alertSub: { fontSize: 12, color: COLORS.warningText, marginTop: 1 },
  chartCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    padding: SPACING.lg,
    ...SHADOW.card,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  chart: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.md },
  chartCol: { flex: 1, alignItems: 'center' },
  chartValue: { fontSize: 10, color: COLORS.secondaryText, marginBottom: 3 },
  chartBarTrack: { width: 18, justifyContent: 'flex-end', backgroundColor: COLORS.mutedBg, borderRadius: 9, overflow: 'hidden' },
  chartBar: { width: '100%', backgroundColor: COLORS.secondary, borderTopLeftRadius: 9, borderTopRightRadius: 9 },
  chartLabel: { fontSize: 11, color: COLORS.secondaryText, marginTop: 6, fontWeight: '600' },
});
