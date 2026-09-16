import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';
import { InventoryItem } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';
import { AlertTriangle, ChevronRight, CalendarClock, CheckCircle2 } from 'lucide-react-native';
import { Segmented, StatusBadge, EmptyState } from '../../src/components/ui';
import { LOW_STOCK_THRESHOLD } from '../../src/services/notificationService';

type Horizon = 'today' | 'week' | 'month';

export default function AlertsScreen() {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  // The bottom nav floats over this screen, so the list has to end above it.
  const { contentInset } = useFloatingTabBar();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [horizon, setHorizon] = useState<Horizon>('week');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const startOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  const daysUntil = (exp: string | null | undefined) => {
    if (!exp) return 0;
    return Math.round((startOf(new Date(exp)).getTime() - startOf(new Date()).getTime()) / (1000 * 60 * 60 * 24));
  };

  const bucket = useCallback((): { today: InventoryItem[]; week: InventoryItem[]; month: InventoryItem[] } => {
    const today: InventoryItem[] = [];
    const week: InventoryItem[] = [];
    const month: InventoryItem[] = [];
    items.forEach((it) => {
      if (!it.expiration_date) return;
      const d = daysUntil(it.expiration_date);
      if (d === 0) today.push(it);
      else if (d >= 1 && d <= 7) week.push(it);
      else if (d > 7 && d <= 30) month.push(it);
    });
    return { today, week, month };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const fetchAlerts = async () => {
    if (!profile) return;
    try {
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', profile.id)
        .neq('status', 'consumed')
        .neq('status', 'wasted');
      if (data) setItems(data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchAlerts(); }, []);

  const groups = bucket();
  const list = horizon === 'today' ? groups.today : horizon === 'week' ? groups.week : groups.month;
  const HEADINGS = {
    today: `Expiring today · ${groups.today.length} item${groups.today.length === 1 ? '' : 's'}`,
    week: `Expiring within 7 days · ${groups.week.length} item${groups.week.length === 1 ? '' : 's'}`,
    month: `Expiring this month · ${groups.month.length} item${groups.month.length === 1 ? '' : 's'}`,
  } as const;

  /**
   * Still on the shelf, but nearly gone.
   *
   * Deliberately not one of the expiry buckets: "expires on Friday" and "only
   * one left" are different questions, and an item can honestly be both.
   *
   * The predicate is the dashboard bell's, term for term — the same
   * `status = 'available'` rows against the same threshold — because that badge
   * counts exactly these items, and two different answers in two places would
   * discredit both. Something already written off is waste to report rather than
   * stock to replace, so it is not counted here either way.
   */
  const lowStockItems = items.filter(
    (it) => it.status === 'available' && Number(it.quantity ?? 0) <= LOW_STOCK_THRESHOLD
  );

  const expiringTotal = groups.today.length + groups.week.length + groups.month.length;
  const nothingAtAll = expiringTotal === 0 && lowStockItems.length === 0;

  const badgeFor = (item: InventoryItem) => {
    const exp = getExpirationStatus(item.expiration_date);
    const d = daysUntil(item.expiration_date);
    if (d === 0) return { label: 'Today', tone: 'danger' as const };
    if (exp === 'expired') return { label: 'Expired', tone: 'danger' as const };
    if (d <= 7) return { label: `${d}d left`, tone: 'warning' as const };
    return { label: `${d}d left`, tone: 'success' as const };
  };

  /**
   * One alert row, shared by both lists so the two cannot drift apart.
   *
   * A plain function rather than a component: a component declared in the render
   * body is a brand new type on every pass, which remounts every row.
   */
  const renderRow = (
    item: InventoryItem,
    icon: React.ReactNode,
    meta: string,
    badge: { label: string; tone: 'success' | 'warning' | 'danger' }
  ) => (
    <Pressable
      key={item.id}
      style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.9 }]}
      onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{item.product_name}</Text>
        <Text style={styles.rowMeta} numberOfLines={2}>{meta}</Text>
      </View>
      <StatusBadge label={badge.label} tone={badge.tone} />
      <ChevronRight size={18} color={COLORS.secondaryText} />
    </Pressable>
  );

  const renderExpiring = ({ item }: { item: InventoryItem }) => {
    const d = daysUntil(item.expiration_date);
    const expiryText =
      d === 0 ? 'Expires today'
        : d === 1 ? 'Expires tomorrow'
        : d < 0 ? `Expired ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago`
        : `Expires in ${d} days · ${item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : ''}`;

    return renderRow(
      item,
      <CalendarClock
        size={22}
        color={d <= 0 ? COLORS.dangerText : d <= 7 ? COLORS.warningText : COLORS.successText}
        strokeWidth={2}
      />,
      `${item.quantity} ${item.unit} · ${expiryText}`,
      badgeFor(item)
    );
  };

  /**
   * Running low, the horizon picker and the section heading all scroll with the
   * list.
   *
   * The picker used to be pinned above it, which stops working the moment
   * Running Low is a section of its own: the segments would sit over a block
   * they do not govern and read as though they filtered it.
   */
  const header = (
    <View style={{ gap: SPACING.md }}>
      {lowStockItems.length > 0 && (
        <View style={{ gap: SPACING.sm }}>
          <View style={styles.blockHeadingRow}>
            <AlertTriangle size={14} color={COLORS.warningText} strokeWidth={2.4} />
            <Text style={styles.blockHeading}>
              Running low · {lowStockItems.length} item{lowStockItems.length === 1 ? '' : 's'}
            </Text>
          </View>
          {lowStockItems.map((item) =>
            renderRow(
              item,
              <AlertTriangle size={22} color={COLORS.warningText} strokeWidth={2} />,
              `${item.quantity} ${item.unit} left · restock soon`,
              { label: 'Low', tone: 'warning' }
            )
          )}
        </View>
      )}

      <Segmented
        value={horizon}
        onChange={setHorizon}
        options={[
          { label: 'Today', value: 'today', count: groups.today.length },
          { label: 'Next 7 Days', value: 'week', count: groups.week.length },
          { label: 'This Month', value: 'month', count: groups.month.length },
        ]}
      />

      {!loading && list.length > 0 && (
        <Text style={styles.sectionHeading}>{HEADINGS[horizon]}</Text>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <Text style={styles.subtitle}>Running low and nearing expiry, in one place</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderExpiring}
        ListHeaderComponent={header}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: SPACING.lg, paddingBottom: contentInset, gap: SPACING.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListEmptyComponent={
          loading ? null : (
            // Held in the space left under the header so the message sits in the
            // middle of the empty screen rather than directly beneath the
            // segmented control with everything below it blank. `flexGrow` and
            // not `flex`: the block keeps its natural height and only the
            // leftover room is distributed, so nothing is squashed on a short
            // screen. The content container needs its own `flexGrow` for there
            // to be any leftover room to take.
            <View style={styles.emptyFill}>
              <EmptyState
                icon={CheckCircle2}
                title={nothingAtAll ? "You're all caught up!" : `Nothing expiring${horizon === 'today' ? ' today' : horizon === 'week' ? ' in the next 7 days' : ' this month'}`}
                hint={
                  nothingAtAll
                    ? 'Nothing is running low and nothing is nearing its date.'
                    : 'Items in this window will show up here as their dates approach.'
                }
              />
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  // No horizontal padding: this now renders inside the list, whose content
  // container already insets the page.
  sectionHeading: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  blockHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blockHeading: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  // Takes the room the header left behind and centres the message in it. The
  // horizontal centring is still EmptyState's own.
  emptyFill: { flexGrow: 1, justifyContent: 'center' },
  rowIcon: {
    width: 42, height: 42, borderRadius: RADII.icon,
    backgroundColor: COLORS.mutedBg, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  rowMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 3 },
});
