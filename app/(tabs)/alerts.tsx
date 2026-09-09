import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { InventoryItem } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';
import { ChevronRight, CalendarClock, CheckCircle2 } from 'lucide-react-native';
import { Segmented, StatusBadge, EmptyState } from '../../src/components/ui';

type Horizon = 'today' | 'week' | 'month';

export default function AlertsScreen() {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
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

  const badgeFor = (item: InventoryItem) => {
    const exp = getExpirationStatus(item.expiration_date);
    const d = daysUntil(item.expiration_date);
    if (d === 0) return { label: 'Today', tone: 'danger' as const };
    if (exp === 'expired') return { label: 'Expired', tone: 'danger' as const };
    if (d <= 7) return { label: `${d}d left`, tone: 'warning' as const };
    return { label: `${d}d left`, tone: 'success' as const };
  };

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const badge = badgeFor(item);
    const d = daysUntil(item.expiration_date);
    const expiryText =
      d === 0 ? 'Expires today'
        : d === 1 ? 'Expires tomorrow'
        : d < 0 ? `Expired ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago`
        : `Expires in ${d} days · ${item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : ''}`;

    return (
      <Pressable
        style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.9 }]}
        onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}
      >
        <View style={styles.rowIcon}>
          <CalendarClock size={22} color={d <= 0 ? COLORS.dangerText : d <= 7 ? COLORS.warningText : COLORS.successText} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>{item.product_name}</Text>
          <Text style={styles.rowMeta}>{item.quantity} {item.unit} · {expiryText}</Text>
        </View>
        <StatusBadge label={badge.label} tone={badge.tone} />
        <ChevronRight size={18} color={COLORS.secondaryText} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Expiration Alerts</Text>
        <Text style={styles.subtitle}>Items nearing their expiry date</Text>
      </View>

      <View style={{ paddingHorizontal: SPACING.lg, marginBottom: SPACING.md }}>
        <Segmented
          value={horizon}
          onChange={setHorizon}
          options={[
            { label: 'Today', value: 'today', count: groups.today.length },
            { label: 'Next 7 Days', value: 'week', count: groups.week.length },
            { label: 'This Month', value: 'month', count: groups.month.length },
          ]}
        />
      </View>

      {!loading && list.length > 0 && (
        <Text style={styles.sectionHeading}>{HEADINGS[horizon]}</Text>
      )}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={CheckCircle2}
              title={groups.today.length + groups.week.length + groups.month.length === 0 ? "You're all caught up!" : `Nothing expiring${horizon === 'today' ? ' today' : horizon === 'week' ? ' in the next 7 days' : ' this month'}`}
              hint="Items in this window will show up here as their dates approach."
            />
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
  sectionHeading: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  rowIcon: {
    width: 42, height: 42, borderRadius: RADII.icon,
    backgroundColor: COLORS.mutedBg, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  rowMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 3 },
});
