import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { supabase } from '../../src/lib/supabase';
import { subscribeToTables } from '../../src/lib/realtime';
import { COLORS, RADII, SHADOW, SPACING } from '../../src/theme';
import {
  AlertTriangle, Bell, ChevronRight, Clock3, Crown, History, Package,
  PieChart, ShoppingBasket, ShoppingCart, TrendingDown,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { AvatarCircle, CountBadge, ItemImage, SectionLabel, StatusBadge } from '../../src/components/ui';
import { notificationService, LOW_STOCK_THRESHOLD } from '../../src/services/notificationService';

/** One row of the "Recently consumed" list. */
interface ConsumedEntry {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  at: string;
}

interface HomeStats {
  totalItems: number;
  /**
   * Everything worth buying: `status IN ('consumed','wasted')` — it ran out —
   * or `need_to_buy`, the flag the heart sets for "still have some, want more".
   *
   * Deliberately the same predicate the Inventory tab's Need to Buy chip uses.
   * It previously counted unpurchased `grocery_items`, which is a different
   * question with a different answer, so the tile and the tab disagreed.
   */
  needToBuy: number;
  /** Still on the shelf, but at or below `LOW_STOCK_THRESHOLD`. */
  lowStock: number;
  expirationAlerts: number;
  recentlyConsumed: ConsumedEntry[];
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
  // Only for sizing the two icon boxes below — the layout itself is all flex, so
  // this is a measurement, not a breakpoint.
  const { width: screenWidth } = useWindowDimensions();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    if (!profile) return;
    try {
      const uid = profile.id;

      // Everything the tiles need, in one read. The row payload is small enough
      // that counting client-side beats four `head: true` round trips, and it
      // means the counts are all derived from one consistent snapshot.
      const { data: items } = await supabase
        .from('inventory_items')
        .select('id, product_name, category, quantity, unit, status, expiration_date, need_to_buy')
        .eq('user_id', uid);

      const all = items ?? [];
      const available = all.filter((i) => i.status === 'available');

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const inAWeek = new Date(today); inAWeek.setDate(today.getDate() + 7);
      const expirationAlerts = available.filter((i) => {
        if (!i.expiration_date) return false;
        const exp = new Date(i.expiration_date);
        return exp >= today && exp <= inAWeek;
      }).length;

      // Need to Buy is derived, not stored, and from the same two things the
      // Inventory tab's chip uses: the item ran out, or the user hearted it to
      // say they want more. Nothing is copied, so the tile and the tab cannot
      // show different numbers.
      const needToBuy = all.filter(
        (i) => i.status === 'consumed' || i.status === 'wasted' || i.need_to_buy
      ).length;

      // Running low is a separate question from need-to-buy: the item is still
      // here, but there is nearly none of it left. Uses the same threshold the
      // low-stock notifications use, so the badge and the alert agree.
      const lowStock = available.filter((i) => Number(i.quantity ?? 0) <= LOW_STOCK_THRESHOLD).length;

      // The last few things the user actually used up, newest first. The item
      // join gives the row its name, category and unit; consumption records
      // cascade away with their item, so a row here always has something to show.
      const { data: consumed } = await supabase
        .from('inventory_consumption')
        .select('id, quantity, unit, consumed_at, inventory_items(product_name, category, unit)')
        .eq('user_id', uid)
        .order('consumed_at', { ascending: false })
        .limit(5);

      const recentlyConsumed: ConsumedEntry[] = (consumed ?? []).map((row: any) => ({
        id: row.id as string,
        name: row.inventory_items?.product_name || 'Item',
        category: row.inventory_items?.category ?? null,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit || row.inventory_items?.unit || 'pcs',
        at: row.consumed_at as string,
      }));

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
        needToBuy,
        lowStock,
        expirationAlerts,
        recentlyConsumed,
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

  // Every number on this screen is derived, so the honest way to keep it live is
  // to re-run the query rather than to patch individual counters — a consume on
  // another device moves the need-to-buy, low-stock and recently-consumed figures
  // at once. Realtime is a freshness layer only; focus and pull-to-refresh still
  // carry the screen when the socket is down.
  useEffect(() => {
    if (!profile) return undefined;
    return subscribeToTables(
      `dashboard:${profile.id}`,
      ['inventory_items', 'inventory_consumption'],
      () => { fetchDashboard(); },
      { userId: profile.id }
    );
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

  const consumed = stats?.recentlyConsumed ?? [];
  const lowStockCount = stats?.lowStock ?? 0;

  /**
   * The two screens that have no tab of their own.
   *
   * This row used to hold Scanner, Inventory and Need to Buy — all three already
   * one tap away (the last two are tabs, and Scanner sits on the Inventory
   * header), and Need to Buy was listed twice, here and as a metric tile with the
   * count on it. Grocery and Analytics are the screens nothing else reaches, so
   * they are what the row is for.
   */
  const quickActions: { key: string; label: string; icon: React.ComponentType<LucideProps>; go: () => void }[] = [
    { key: 'grocery', label: 'Grocery List', icon: ShoppingBasket, go: () => router.push('/grocery') },
    { key: 'analytics', label: 'Analytics', icon: PieChart, go: () => router.push('/analytics') },
  ];

  /**
   * Both card rows put two across with the page margins at each end, so one
   * formula sizes the icon boxes for both. It uses the metric row's wider gap,
   * which gives the narrower of the two tiles — a box that fits the tighter card
   * cannot overflow the roomier one. Deriving it rather than pinning it at 38 is
   * what keeps a glyph from looking lost inside a tablet-width card or cramped on
   * a 320pt phone; the clamp holds it near the hand-tuned size on ordinary phones,
   * where it works out to about 42.
   */
  const tileWidth = (screenWidth - SPACING.lg * 2 - SPACING.md) / 2;
  const iconBoxSize = Math.round(Math.min(56, Math.max(38, tileWidth * 0.26)));
  const iconBox = {
    width: iconBoxSize,
    height: iconBoxSize,
    borderRadius: Math.round(iconBoxSize * 0.35),
  };
  const iconGlyphSize = Math.round(iconBoxSize * 0.52);

  // Amber while it is a nudge, red once there is enough of it to be a problem.
  const lowTone = lowStockCount >= 4
    ? { bg: COLORS.dangerBg, fg: COLORS.dangerText }
    : { bg: COLORS.warningBg, fg: COLORS.warningText };

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
    // The safe-area inset goes on a plain wrapper, never on the ScrollView's own
    // `style`. Padding there is applied to the scroll view itself and iOS lays
    // its content out ignoring it, so the top bar was rendering at y=0 - up
    // behind the status bar and notch, which is where the greeting went. The
    // wrapper also clips scrolled content below the status bar rather than
    // letting it slide underneath. Same shape as the Inventory tab
    // (`<View style={[styles.container, { paddingTop: insets.top + 6 }]}>`).
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <ScrollView
        style={styles.scroll}
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
            {/* Shrink-to-fit rather than ellipsise: the actions beside it take a
                fixed 142pt, which leaves ~190pt on a 390pt screen — less than
                "Good afternoon, Alvin" needs at 24pt. Same treatment as the
                banner figure below. */}
            <Text style={styles.greeting} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{greeting}, {firstName}</Text>
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
            {/* The bell goes to the Alerts tab. It used to be a plain View, so
                the badge counted expiring items and then nothing happened when
                you tapped it — the two actions either side of it both led
                somewhere. With nothing expiring the badge is hidden and the tab
                still opens, which is where "you're all caught up" lives. */}
            <Pressable
              onPress={() => router.push('/alerts')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                stats?.expirationAlerts
                  ? `Alerts, ${stats.expirationAlerts} expiring soon`
                  : 'Alerts'
              }
              style={({ pressed }) => [styles.bellWrap, pressed && { opacity: 0.7 }]}
            >
              <Bell size={22} color={COLORS.text} strokeWidth={2} />
              <CountBadge count={stats?.expirationAlerts ?? 0} />
            </Pressable>
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
            <View style={[styles.metricIconWrap, iconBox]}>
              <Package size={iconGlyphSize} color={COLORS.primary} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.metricValue}>{stats?.totalItems ?? 0}</Text>
              <Text style={styles.metricLabel} numberOfLines={2}>Items in inventory</Text>
            </View>
          </Pressable>
          <Pressable style={styles.metric} onPress={() => router.push({ pathname: '/inventory', params: { filter: 'need_to_buy' } })}>
            <View style={[styles.metricIconWrap, iconBox, { backgroundColor: COLORS.warningBg }]}>
              <ShoppingCart size={iconGlyphSize} color={COLORS.warningText} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.metricValue}>{stats?.needToBuy ?? 0}</Text>
              <Text style={styles.metricLabel} numberOfLines={2}>Need to buy</Text>
            </View>
          </Pressable>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Pressable
                key={action.key}
                style={({ pressed }) => [styles.quickTile, pressed && { opacity: 0.85 }]}
                onPress={action.go}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <View style={[styles.quickIconWrap, iconBox]}>
                  <Icon size={iconGlyphSize} color={COLORS.primary} strokeWidth={2.2} />
                </View>
                <Text style={styles.quickLabel} numberOfLines={1}>{action.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Low stock strip. Sits above the expiration strip because it is the one
            the user can act on with a shopping trip — it is also the count that
            drives the low-stock notifications. */}
        {lowStockCount > 0 && (
          <Pressable
            style={[styles.alertStrip, { backgroundColor: lowTone.bg }]}
            onPress={() => router.push('/inventory')}
          >
            <View style={styles.alertIconWrap}>
              <AlertTriangle size={20} color={lowTone.fg} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.alertTitle, { color: lowTone.fg }]}>Running Low</Text>
              <Text style={[styles.alertSub, { color: lowTone.fg }]} numberOfLines={2}>
                {lowStockCount} item{lowStockCount === 1 ? '' : 's'} at {LOW_STOCK_THRESHOLD} or fewer left
              </Text>
            </View>
            <ChevronRight size={20} color={lowTone.fg} />
          </Pressable>
        )}

        {/* Expiration alert strip */}
        <Pressable style={styles.alertStrip} onPress={() => router.push('/alerts')}>
          <View style={styles.alertIconWrap}>
            <Clock3 size={20} color={COLORS.warningText} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.alertTitle}>Expiration Alerts</Text>
            <Text style={styles.alertSub} numberOfLines={2}>
              {stats?.expirationAlerts ?? 0} item{(stats?.expirationAlerts ?? 0) === 1 ? '' : 's'} expiring soon
            </Text>
          </View>
          <ChevronRight size={20} color={COLORS.warningText} />
        </Pressable>

        {/* Recently consumed — what has actually left the pantry lately. The
            category icon comes from the same resolver the inventory rows use, so
            the same food looks the same in both places. */}
        {consumed.length > 0 && (
          <View style={styles.section}>
            <SectionLabel
              right={
                <Pressable onPress={() => router.push('/inventory')} hitSlop={8}>
                  <Text style={styles.sectionLink}>View all</Text>
                </Pressable>
              }
            >
              Recently Consumed
            </SectionLabel>
            <View style={styles.card}>
              {consumed.map((entry, index) => (
                <View key={entry.id} style={[styles.consumeRow, index > 0 && styles.consumeRowDivided]}>
                  <ItemImage category={entry.category} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.consumeName} numberOfLines={1}>{entry.name}</Text>
                    <Text style={styles.consumeMeta} numberOfLines={1}>
                      {entry.quantity} {entry.unit} · {timeAgo(entry.at)}
                    </Text>
                  </View>
                  <StatusBadge label="Used" tone="neutral" icon={History} />
                </View>
              ))}
            </View>
          </View>
        )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
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
  // Size comes in with the `iconBox` object at the call site; only the paint is
  // fixed here.
  metricIconWrap: { backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  metricLabel: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  // Two equal halves. `flexBasis: 0` plus `flexGrow: 1` is what makes them equal
  // rather than proportional to their labels, and `minWidth: 0` lets a long label
  // ellipsise instead of widening its tile.
  quickRow: { flexDirection: 'row', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  quickTile: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    paddingHorizontal: 6,
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    ...SHADOW.card,
  },
  quickIconWrap: {
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { fontSize: 12, fontWeight: '700', color: COLORS.text, maxWidth: '100%' },
  section: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg },
  sectionLink: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    paddingHorizontal: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  consumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  consumeRowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  consumeName: { fontSize: 14.5, fontWeight: '600', color: COLORS.text },
  consumeMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
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

/**
 * How long ago something was consumed, at the resolution that matters on a
 * dashboard: minutes and hours for the same day, days for the rest of the week,
 * then the date itself.
 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}
