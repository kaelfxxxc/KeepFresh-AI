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
  CalendarDays, ChevronRight, Crown, History, Package,
  PieChart, ShoppingBasket, ShoppingCart, TrendingDown,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { AvatarCircle, ItemImage, SectionLabel, StatusBadge } from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { DateRangePickerModal } from '../../src/components/DateRangePicker';
import { notificationService, LOW_STOCK_THRESHOLD } from '../../src/services/notificationService';
import { timeAgo } from '../../src/utils/timeAgo';
import { todayKey } from '../../src/utils/dateKey';
import {
  buildWasteTrend, defaultRange, earliestSelectableKey, formatRangeLabel,
  monthKeyIn, monthKeyOf, queryStartIso, unitLabel,
} from '../../src/utils/wasteTrend';
import type { BucketUnit, TrendBucket } from '../../src/utils/wasteTrend';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';

/** One row of the "Recently consumed" list. */
interface ConsumedEntry {
  id: string;
  name: string;
  category: string | null;
  /** A bucket path or a remote URL — signed for display by ItemImage. */
  imageUrl: string | null;
  quantity: number;
  unit: string;
  at: string;
}

interface HomeStats {
  totalItems: number;
  /**
   * Everything worth buying: `need_to_buy` — the flag the heart sets for "want
   * more of this" — or an item still on the shelf with no quantity left.
   *
   * Deliberately the same predicate the Inventory tab's Need to Buy chip uses.
   * It previously counted unpurchased `grocery_items`, which is a different
   * question with a different answer, so the tile and the tab disagreed; then it
   * counted consumed and wasted rows, which that tab now files under History.
   */
  needToBuy: number;
  /** Still on the shelf, but at or below `LOW_STOCK_THRESHOLD`. */
  lowStock: number;
  expirationAlerts: number;
  recentlyConsumed: ConsumedEntry[];
  wasteThisMonth: number;   // item count this month
  /**
   * Percentage change against last month, or `null` when there is no last month
   * to compare against (nothing was binned then). Null is a real answer, not a
   * zero: a month that went from no waste to some is not "0% change".
   */
  wasteDeltaPct: number | null;
  /**
   * One point per bucket of the selected range, oldest first. The bucket size
   * follows the range (`bucketUnit` says which), so the chart is always legible
   * whatever span the user picked.
   */
  trend: TrendBucket[];
  /** How to read `trend`'s labels — `Daily`, `Weekly` or `Monthly`. */
  bucketUnit: BucketUnit;
  /**
   * The range these buckets were read for.
   *
   * Carried so the chart can tell whether the bars on screen answer the range the
   * header is currently naming. Committing a new range re-reads, and until that
   * read lands the old bars are still in `trend` — drawing them under the new
   * label would show one range's numbers under another's name. Matching these
   * against the committed range is what keeps the pair together, including when
   * the read fails and they never would have.
   */
  rangeStart: string;
  rangeEnd: string;
}

export default function HomeScreen() {
  const { profile } = useAuth();
  const { entitlements, refresh: refreshEntitlements } = useSubscription();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The bottom nav floats over this screen, so the scroll content has to end
  // above it rather than behind it.
  const { contentInset } = useFloatingTabBar();
  // Only for sizing the two icon boxes below — the layout itself is all flex, so
  // this is a measurement, not a breakpoint.
  const { width: screenWidth } = useWindowDimensions();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * The span the trend covers. Seeded from `defaultRange` — the last six months,
   * the view the card showed before the range was selectable — and owned here
   * rather than by the picker, because the read depends on it.
   */
  const [range, setRange] = useState(defaultRange);
  const [rangeOpen, setRangeOpen] = useState(false);

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
      // Inventory tab's chip uses: the user hearted it to say they want more, or
      // the item is still on the shelf with nothing left in it. Nothing is
      // copied, so the tile and the tab cannot show different numbers.
      //
      // It used to count `status IN ('consumed','wasted')` as "it ran out", but
      // those rows are history now and the Inventory tab files them there — so
      // counting them here would have advertised rows the chip below no longer
      // shows. "Ran out" is a quantity question: the ± control floors at zero
      // without flipping the status, so an empty packet is still `available`.
      const needToBuy = all.filter(
        (i) => i.need_to_buy || (i.status === 'available' && Number(i.quantity ?? 0) <= 0)
      ).length;

      // Running low is a separate question from need-to-buy: the item is still
      // here, but there is nearly none of it left. Uses the same threshold the
      // low-stock notifications use, so the badge and the alert agree.
      const lowStock = available.filter((i) => Number(i.quantity ?? 0) <= LOW_STOCK_THRESHOLD).length;

      // The last few things the user actually used up, newest first. The item
      // join gives the row its name, category, unit and photo; consumption
      // records cascade away with their item, so a row here always has something
      // to show.
      const { data: consumed } = await supabase
        .from('inventory_consumption')
        .select('id, quantity, unit, consumed_at, inventory_items(product_name, category, unit, image_url)')
        .eq('user_id', uid)
        .order('consumed_at', { ascending: false })
        .limit(5);

      const recentlyConsumed: ConsumedEntry[] = (consumed ?? []).map((row: any) => ({
        id: row.id as string,
        name: row.inventory_items?.product_name || 'Item',
        category: row.inventory_items?.category ?? null,
        // Carried through so the row shows the photo the item was added with,
        // rather than only ever its category icon.
        imageUrl: row.inventory_items?.image_url ?? null,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit || row.inventory_items?.unit || 'pcs',
        at: row.consumed_at as string,
      }));

      // Waste rows over the selected range. This used to ask only for the
      // current month and then invent a series to draw, so the chart showed
      // numbers nothing in the database backed — and it was pinned to Apr–Aug,
      // which is only the right half-year in August.
      //
      // The read starts at whichever comes first, the range or the start of last
      // month, so the same rows serve the chart the user asked for and the
      // banner's this-month-against-last comparison, which does not move with the
      // range.
      const { data: waste } = await supabase
        .from('food_waste')
        .select('wasted_at')
        .eq('user_id', uid)
        .gte('wasted_at', queryStartIso(range.start));

      // Counted by month, in the app's timezone, for the banner's two figures.
      const byMonth: Record<string, number> = {};
      (waste ?? []).forEach((w) => {
        const k = monthKeyOf(w.wasted_at);
        byMonth[k] = (byMonth[k] || 0) + 1;
      });

      const wasteThisMonth = byMonth[monthKeyIn(0)] ?? 0;
      const prevMonth = byMonth[monthKeyIn(-1)] ?? 0;
      const wasteDeltaPct = prevMonth > 0
        ? Math.round(((wasteThisMonth - prevMonth) / prevMonth) * 100)
        : null;

      // The bars themselves. Bucketing is the trend module's job — it picks the
      // unit from the span, so a fortnight of waste is drawn by the day and two
      // years of it by the month, without the card ever having to decide.
      const { unit: bucketUnit, buckets } = buildWasteTrend(waste ?? [], range.start, range.end);

      setStats({
        totalItems: available.length,
        needToBuy,
        lowStock,
        expirationAlerts,
        recentlyConsumed,
        wasteThisMonth,
        wasteDeltaPct,
        trend: buckets,
        bucketUnit,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
    } catch (e) {
      console.error('Error fetching dashboard:', e);
    } finally {
      setRefreshing(false);
    }
  }, [profile, range]);

  useEffect(() => {
    if (profile) fetchDashboard();
  }, [profile, fetchDashboard]);

  // Every number on this screen is derived, so the honest way to keep it live is
  // to re-run the query rather than to patch individual counters — a consume on
  // another device moves the need-to-buy, low-stock and recently-consumed figures
  // at once, and binning something moves the waste banner and the trend's last
  // bar together. Realtime is a freshness layer only; focus and pull-to-refresh
  // still carry the screen when the socket is down.
  useEffect(() => {
    if (!profile) return undefined;
    return subscribeToTables(
      `dashboard:${profile.id}`,
      ['inventory_items', 'inventory_consumption', 'food_waste'],
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

  const delta = stats?.wasteDeltaPct ?? null;
  const better = (delta ?? 0) <= 0;
  const wasteThisMonth = stats?.wasteThisMonth ?? 0;
  /**
   * The bars for the committed range, or none.
   *
   * Committing a new range re-reads, and until that read lands `stats.trend` is
   * still the previous range's — so the chart waits rather than drawing one
   * range's numbers under another range's name. It also covers the read that
   * never lands: the bars stay withheld instead of going quietly stale.
   */
  const trendFor = stats != null && stats.rangeStart === range.start && stats.rangeEnd === range.end
    ? stats
    : null;
  const trend = trendFor?.trend ?? [];
  const bucketUnit = trendFor?.bucketUnit ?? 'month';

  /** The span the chart covers, as one line for the chip that opens the picker. */
  const rangeLabel = formatRangeLabel(range.start, range.end);

  /**
   * The line that sits beside the percentage, when there is one worth showing.
   *
   * Null until the read lands: "nothing wasted" is a claim about the data, and
   * making it before the data arrives would be asserting something we do not
   * know yet.
   */
  const deltaNote = stats == null
    ? null
    : wasteThisMonth === 0
      ? 'Nothing wasted — great job!'
      // Wasted, with nothing to measure it against — the case the missing chip
      // would otherwise leave unexplained.
      : delta == null
        ? 'Nothing wasted last month to compare'
        : null;

  const maxTrend = Math.max(1, ...(trend.map((t) => t.value)));

  const consumed = stats?.recentlyConsumed ?? [];

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
        contentContainerStyle={{ paddingBottom: contentInset }}
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
            {/* The screen's one place for anything needing attention. Its badge
                is the real unread count from the notification log, and tapping
                it opens a dropdown here rather than navigating away — so the
                count describes exactly the list the tap reveals. */}
            <NotificationBell />
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
            {wasteThisMonth} items
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            {/* The chip is the comparison, and there is only a comparison when
                last month had waste: no baseline is not the same as no change,
                so it is left off rather than shown as 0%. The note beside it
                says which of the two "nothing to compare" and "nothing wasted"
                actually applies. */}
            {delta != null && (
              <View style={[styles.deltaChip, better ? { backgroundColor: COLORS.successBg } : { backgroundColor: COLORS.dangerBg }]}>
                <TrendingDown size={12} color={better ? COLORS.successText : COLORS.dangerText} strokeWidth={2.5} />
                <Text style={[styles.deltaText, { color: better ? COLORS.successText : COLORS.dangerText }]}>
                  {better ? '' : '+'}{delta}% vs last month
                </Text>
              </View>
            )}
            {deltaNote && <Text style={styles.deltaNote}>{deltaNote}</Text>}
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

        {/* Waste trend — real rows from `food_waste`, bucketed to suit the span
            the user picked, with a bucket nothing was binned in drawn as no bar
            rather than as a stub.

            The range chip is the control, not a label: it opens the picker, and
            it is also where the span is read back. The unit sits opposite it,
            because day and week buckets are labelled with a bare number and
            "12" means nothing until you know whether it is a day or a week. */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Food Waste Trend</Text>
          <View style={styles.chartHeaderRow}>
            <Pressable
              style={({ pressed }) => [styles.rangeChip, pressed && { opacity: 0.75 }]}
              onPress={() => setRangeOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Time range: ${rangeLabel}. Change the range`}
            >
              <CalendarDays size={13} strokeWidth={2.4} color={COLORS.primaryDark} />
              <Text style={styles.rangeChipText} numberOfLines={1}>{rangeLabel}</Text>
              <ChevronRight size={13} strokeWidth={2.6} color={COLORS.primaryDark} />
            </Pressable>
            {trendFor && <Text style={styles.unitCaption}>{unitLabel(bucketUnit)}</Text>}
          </View>
          {trendFor == null ? (
            // Waiting on the read for the committed range — the first one, or a
            // new range's. Not to be confused with "no waste": that is a real
            // result and is drawn as a row of zero-height bars, which says it
            // plainly. `buildWasteTrend` always returns at least one bucket, so
            // this branch is only ever the wait.
            <View style={styles.chartWaiting}>
              <Text style={styles.chartWaitingText}>Loading…</Text>
            </View>
          ) : (
            <View style={styles.chart}>
              {trend.map((pt, i) => (
                <View key={i} style={styles.chartCol}>
                  <Text style={styles.chartValue}>{pt.value}</Text>
                  <View style={[styles.chartBarTrack, { height: 74 }]}>
                    <View
                      style={[
                        styles.chartBar,
                        { height: pt.value > 0 ? Math.max(4, (pt.value / maxTrend) * 74) : 0 },
                      ]}
                    />
                  </View>
                  <Text style={styles.chartLabel}>{pt.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Recently consumed — what has actually left the pantry lately. The
            item's own photo when it has one, falling back to the category icon
            from the same resolver the inventory rows use, so the same food looks
            the same in both places.

            Sits under the trend rather than above it: the chart is the summary of
            the month, and the rows below it are the detail behind that summary —
            read the other way round, the detail arrived before the point it was
            supporting. */}
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
                  <ItemImage uri={entry.imageUrl} category={entry.category} size={38} />
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
      </ScrollView>

      {/* The range picker sits outside the ScrollView: it is presented over the
          whole screen, and inside a scroll container it would be clipped to the
          scrolled viewport rather than centred on the display. */}
      <DateRangePickerModal
        visible={rangeOpen}
        start={range.start}
        end={range.end}
        minDate={earliestSelectableKey()}
        maxDate={todayKey()}
        title="Trend range"
        onCancel={() => setRangeOpen(false)}
        onConfirm={(start, end) => {
          setRange({ start, end });
          setRangeOpen(false);
        }}
        onReset={() => {
          setRange(defaultRange());
          setRangeOpen(false);
        }}
      />
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
  chartCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    padding: SPACING.lg,
    ...SHADOW.card,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  // The chip takes the slack and the unit caption keeps its intrinsic width, so
  // a long range label ellipsises instead of pushing the unit off the card.
  chartHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACING.sm, marginTop: 6,
  },
  rangeChip: {
    flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.pill,
    paddingVertical: 6, paddingHorizontal: 11,
  },
  rangeChipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },
  unitCaption: { fontSize: 11.5, fontWeight: '700', color: COLORS.secondaryText },
  chart: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.md },
  // Matches what the bars occupy — value line, 74pt track, label — plus the
  // chart's own top margin, so the card does not resize when the read lands and
  // push the rest of the page down.
  chartWaiting: { marginTop: SPACING.md, height: 110, alignItems: 'center', justifyContent: 'center' },
  chartWaitingText: { fontSize: 12.5, color: COLORS.secondaryText },
  chartCol: { flex: 1, alignItems: 'center' },
  chartValue: { fontSize: 10, color: COLORS.secondaryText, marginBottom: 3 },
  chartBarTrack: { width: 18, justifyContent: 'flex-end', backgroundColor: COLORS.mutedBg, borderRadius: 9, overflow: 'hidden' },
  chartBar: { width: '100%', backgroundColor: COLORS.secondary, borderTopLeftRadius: 9, borderTopRightRadius: 9 },
  chartLabel: { fontSize: 11, color: COLORS.secondaryText, marginTop: 6, fontWeight: '600' },
});
