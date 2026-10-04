import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { supabase } from '../../src/lib/supabase';
import { subscribeToTables } from '../../src/lib/realtime';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { CalendarDays, ChevronRight, Crown } from 'lucide-react-native';
import { SvgXml } from 'react-native-svg';
import { DASHBOARD_ICONS } from '../../src/constants/dashboardIcons';
import { AvatarCircle, ItemImage, StatCard, TrendBarChart, AIBanner, SectionHeader, StatusPill, colorWithOpacity } from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { DateRangePickerModal } from '../../src/components/DateRangePicker';
import { notificationService, LOW_STOCK_THRESHOLD } from '../../src/services/notificationService';
import { timeAgo } from '../../src/utils/timeAgo';
import { todayKey } from '../../src/utils/dateKey';
import {
  buildWasteTrend, defaultRange, earliestSelectableKey, formatRangeLabel,
  queryStartIso, unitLabel,
} from '../../src/utils/wasteTrend';
import type { BucketUnit, TrendBucket } from '../../src/utils/wasteTrend';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';
import { usePageGutter } from '../../src/hooks/useContentLayout';



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

interface RecentConsumptionRow {
  id: string;
  quantity: number | null;
  unit: string | null;
  consumed_at: string;
  inventory_items: {
    product_name: string | null;
    category: string | null;
    unit: string | null;
    image_url: string | null;
  } | null;
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
  // The page gutter, not the raw screen width: on a tablet the content column
  // stops growing at `CONTENT_MAX_WIDTH` and centres. On a phone this is just
  // the usual margin, so nothing on the layouts below moves.
  const { gutter } = usePageGutter();
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

      const recentlyConsumed: ConsumedEntry[] = ((consumed ?? []) as RecentConsumptionRow[]).map((row) => ({
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

      // Read only the selected date range; this data now serves the trend chart.
      const { data: waste } = await supabase
        .from('food_waste')
        .select('wasted_at')
        .eq('user_id', uid)
        .gte('wasted_at', queryStartIso(range.start));

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
  // chart together. Realtime is a freshness layer only; focus and pull-to-refresh
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
        <Text style={{ color: colors.textSecondary }}>Loading dashboard…</Text>
      </View>
    );
  }

  const firstName = (profile.full_name || 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

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

  const maxTrend = Math.max(1, ...(trend.map((t) => t.value)));

  const consumed = stats?.recentlyConsumed ?? [];

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
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); refreshEntitlements(); fetchDashboard(); }} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {/* Top bar. The greeting takes the slack so the actions keep their
            intrinsic width, and minWidth 0 on it lets the row shrink instead of
            pushing past the screen edge. */}
        <View style={[styles.topBar, { paddingHorizontal: gutter }]}>
          <View style={styles.greetingBlock}>
            {/* Shrink the greeting when the available column is narrow so the
                name and action buttons remain visible on compact phones. */}
            <Text
              style={styles.greeting}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {greeting},{`\n`}{firstName}
            </Text>
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
                color={entitlements?.is_active === false ? colors.danger : colors.primary}
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

        <View style={[styles.planNotice, { marginHorizontal: gutter }]}>
          <View style={styles.planNoticeCopy}>
            <StatusPill status="active" label={entitlements?.is_active === false ? 'ENDED' : 'ACTIVE'} />
            <Text style={styles.planNoticeText} numberOfLines={1}>
              {entitlements?.is_active === false ? 'Your plan has ended' : 'Your plan is active'}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/subscription')} hitSlop={8}>
            <Text style={styles.planNoticeAction}>Manage <ChevronRight size={14} color={colors.primary} /></Text>
          </Pressable>
        </View>

        <View style={[styles.contentStack, { paddingHorizontal: gutter }]}>
          {/* 2-column StatCard Grid */}
          <View style={styles.metricGrid}>
            <StatCard
              index={0}
              iconElement={<SvgXml xml={DASHBOARD_ICONS.inventory} width={20} height={20} />}
              title="Items in inventory"
              value={`${stats?.totalItems ?? 0}`}
              iconBg={colors.primary}
              onPress={() => router.push('/inventory')}
            />
            <StatCard
              index={1}
              iconElement={<SvgXml xml={DASHBOARD_ICONS.needToBuy} width={20} height={20} />}
              title="Need to buy"
              value={`${stats?.needToBuy ?? 0}`}
              iconBg={colors.warning}
              onPress={() => router.push('/inventory')}
            />
          </View>
          <View style={styles.metricGrid}>
            <StatCard
              index={2}
              iconElement={<SvgXml xml={DASHBOARD_ICONS.grocery} width={20} height={20} />}
              title="Grocery List"
              value="Open"
              caption="Smart list & scan"
              iconBg={colors.primaryDark}
              onPress={() => router.push('/grocery')}
            />
            <StatCard
              index={3}
              iconElement={<SvgXml xml={DASHBOARD_ICONS.analytics} width={20} height={20} />}
              title="Analytics"
              value="Reports"
              caption="Waste & savings"
              iconBg={colors.primary}
              onPress={() => router.push('/analytics')}
            />
          </View>

          {/* Waste trend card with TrendBarChart */}
          <View style={styles.chartCard}>
            <View style={styles.chartHeaderRow}>
              <View>
                <Text style={styles.chartTitle}>Food Waste Trend</Text>
                {trendFor && <Text style={styles.unitCaption}>{unitLabel(bucketUnit)}</Text>}
              </View>
              <Pressable
                style={({ pressed }) => [styles.rangeChip, pressed && { opacity: 0.75 }]}
                onPress={() => setRangeOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Time range: ${rangeLabel}. Change the range`}
              >
                <CalendarDays size={13} strokeWidth={2.4} color={colors.primaryDark} />
                <Text style={styles.rangeChipText} numberOfLines={1}>{rangeLabel}</Text>
                <ChevronRight size={13} strokeWidth={2.6} color={colors.primaryDark} />
              </Pressable>
            </View>

            {trendFor == null ? (
              <View style={styles.chartWaiting}>
                <Text style={styles.chartWaitingText}>Loading…</Text>
              </View>
            ) : (
              <TrendBarChart
                index={4}
                data={trend.map((pt) => pt.value)}
                currentIndex={trend.length - 1}
                labels={trend.map((pt) => pt.label)}
                maxValue={maxTrend}
              />
            )}
          </View>

          {/* Recently consumed section */}
          {consumed.length > 0 && (
            <View style={styles.sectionWrap}>
              <SectionHeader
                title="Recently Consumed"
                actionLabel="View all"
                onActionPress={() => router.push('/inventory')}
              />
              <View style={styles.card}>
                {consumed.map((entry, index) => (
                  <View key={entry.id} style={[styles.consumeRow, index > 0 && styles.consumeRowDivided]}>
                    <ItemImage uri={entry.imageUrl} category={entry.category} size={42} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.consumeName} numberOfLines={1}>{entry.name}</Text>
                      <Text style={styles.consumeMeta} numberOfLines={1}>
                        {entry.quantity} {entry.unit} · {timeAgo(entry.at)}
                      </Text>
                    </View>
                    <StatusPill status="fresh" label="Used" />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* AI Freshness Banner */}
          <AIBanner
            index={5}
            icon="sparkle"
            title="AI Freshness Insight"
            body={
              stats?.expirationAlerts && stats.expirationAlerts > 0
                ? `You have ${stats.expirationAlerts} item${stats.expirationAlerts === 1 ? '' : 's'} expiring soon. Discover recipes to cook them today!`
                : "Your pantry is well stocked and fresh. Use smart grocery and barcode scanning for easy tracking."
            }
            ctaLabel={stats?.expirationAlerts && stats.expirationAlerts > 0 ? "View recipes" : undefined}
            onPressCta={stats?.expirationAlerts && stats.expirationAlerts > 0 ? () => router.push('/recipes') : undefined}
          />
        </View>
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
  container: { flex: 1, backgroundColor: colors.screenBg },
  scroll: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  greetingBlock: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 26, lineHeight: 31, fontWeight: '800', color: colors.textPrimary },
  subGreeting: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  planNotice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.mintBg,
    borderWidth: 1,
    borderColor: colorWithOpacity(colors.primary, 0.2),
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  planNoticeCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  planNoticeText: { flex: 1, fontSize: 13, color: colors.textPrimary },
  planNoticeAction: { flexDirection: 'row', alignItems: 'center', color: colors.primary, fontSize: 13, fontWeight: '700' },
  planButton: {
    width: 42,
    height: 42,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  contentStack: {
    gap: spacing.md,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  chartTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  chartHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  rangeChip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.mintBg,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  rangeChipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  unitCaption: { fontSize: 11.5, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  chartWaiting: { height: 110, alignItems: 'center', justifyContent: 'center' },
  chartWaitingText: { fontSize: 12.5, color: colors.textSecondary },
  sectionWrap: {
    gap: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  consumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  consumeRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  consumeName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  consumeMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
