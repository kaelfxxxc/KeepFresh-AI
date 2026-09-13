import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet, Alert, RefreshControl, ScrollView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { inventoryService } from '../../src/services/inventoryService';
import { storageAreaService, storageEmoji } from '../../src/services/storageAreaService';
import { subscribeToTables, applyRealtimeEvent, type RealtimeStatus } from '../../src/lib/realtime';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { InventoryItem, StorageArea } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';
import { Search, Plus, SlidersHorizontal, Package, ScanLine, WifiOff } from 'lucide-react-native';
import {
  Chip, StatusBadge, EmptyState, ItemImage, QuantityPrompt, QuantityStepper, UpgradeNotice,
} from '../../src/components/ui';

type Filter = 'all' | 'available' | 'need_to_buy';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Available' },
  { key: 'need_to_buy', label: 'Need to Buy' },
];

/** `'all'` and `'unassigned'` are buckets; anything else is a storage area id. */
type AreaFilter = 'all' | 'unassigned' | string;

export default function InventoryScreen() {
  const { profile } = useAuth();
  const { gates } = useSubscription();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [consumeTarget, setConsumeTarget] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [steppingId, setSteppingId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<RealtimeStatus | null>(null);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);

  const fetchInventory = useCallback(async () => {
    if (!profile) return;
    try {
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      if (data) setItems(data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  const fetchAreas = useCallback(async () => {
    if (!profile) return;
    try {
      setAreas(await storageAreaService.list(profile.id));
    } catch {
      // A missing area list only costs us the filter row — never the inventory.
    }
  }, [profile]);

  useEffect(() => { fetchInventory(); fetchAreas(); }, [fetchInventory, fetchAreas]);

  // Refetch when the tab regains focus so items added from the Scan screen (or
  // edited elsewhere) show up — with their product photo — without a manual
  // pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (profile) { fetchInventory(); fetchAreas(); }
    }, [profile, fetchInventory, fetchAreas])
  );

  // Live sync across devices: a teammate's quantity change, a scan from the
  // phone, an edit in another tab. Realtime is a freshness layer only — when the
  // socket is down the screen still works off focus + pull-to-refresh, which is
  // why the failure state is a quiet hint rather than an error.
  useEffect(() => {
    if (!profile) return undefined;

    return subscribeToTables(
      `inventory:${profile.id}`,
      ['inventory_items', 'storage_areas'],
      (event) => {
        if (event.table === 'storage_areas') {
          fetchAreas();
          return;
        }
        // Skip the echo of our own in-flight ± tap; the RPC's answer is
        // authoritative and already applied.
        if (steppingId && (event.new as InventoryItem)?.id === steppingId) return;
        setItems((prev) => applyRealtimeEvent(prev, event));
      },
      { userId: profile.id, onStatus: setLiveStatus }
    );
  }, [profile, fetchAreas, steppingId]);

  const onRefresh = () => { setRefreshing(true); fetchInventory(); fetchAreas(); };

  /**
   * The ± control.
   *
   * Applied optimistically so the number moves under the finger, then reconciled
   * with the row the database actually wrote. Because the increment happens
   * server-side under a row lock, a stale local count cannot win — and the floor
   * at zero holds even if two devices tap at once.
   */
  const stepQuantity = useCallback(
    async (item: InventoryItem, delta: number) => {
      if (delta < 0 && item.quantity <= 0) return;

      setSteppingId(item.id);
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, quantity: Math.max(row.quantity + delta, 0) } : row
        )
      );

      try {
        const updated = await inventoryService.adjustQuantity(item.id, delta);
        setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      } catch (error: any) {
        // Put the real number back rather than leaving the guess on screen.
        setItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
        Alert.alert(
          'Could not update quantity',
          error?.message ?? 'Check your connection and try again.'
        );
      } finally {
        setSteppingId(null);
      }
    },
    []
  );

  /**
   * How many live items sit in each area. Counted from the rows we already hold
   * rather than a second round-trip, so the chips can never disagree with the
   * list they filter.
   */
  const areaCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, unassigned: 0 };
    items.forEach((item) => {
      if (item.status === 'consumed' || item.status === 'wasted') return;
      counts.all += 1;
      if (item.storage_area_id) {
        counts[item.storage_area_id] = (counts[item.storage_area_id] ?? 0) + 1;
      } else {
        counts.unassigned += 1;
      }
    });
    return counts;
  }, [items]);

  const showAreaRow = areas.length > 0 && (areas.length > 1 || areaCounts.unassigned > 0);

  const handleDelete = (item: InventoryItem) => {
    Alert.alert('Delete Item', `Are you sure you want to remove "${item.product_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('inventory_items').delete().eq('id', item.id);
          fetchInventory();
        },
      },
    ]);
  };

  const handleConsume = (item: InventoryItem) => setConsumeTarget(item);

  // Goes through the consume_inventory_item RPC: it locks the row, clamps the
  // quantity to what's on hand, and writes the consumption record atomically.
  const confirmConsume = async (qty: number) => {
    const item = consumeTarget;
    if (!item || !profile) return;
    setBusy(true);
    try {
      await inventoryService.consumeInventoryItem(profile.id, item.id, qty);
      setConsumeTarget(null);
      await fetchInventory();
    } catch (error: any) {
      Alert.alert('Could not record usage', error?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q ||
      item.product_name.toLowerCase().includes(q) ||
      (item.brand || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q);

    const matchesArea =
      areaFilter === 'all'
        ? true
        : areaFilter === 'unassigned'
          ? !item.storage_area_id
          : item.storage_area_id === areaFilter;

    if (!matchesArea) return false;
    if (filter === 'available') return matchesSearch && item.status === 'available';
    if (filter === 'need_to_buy') return matchesSearch && (item.status === 'consumed' || item.status === 'wasted');
    return matchesSearch;
  });

  const statusOf = (item: InventoryItem) => {
    if (item.status === 'consumed') return { label: 'Consumed', tone: 'neutral' as const };
    if (item.status === 'wasted') return { label: 'Wasted', tone: 'danger' as const };
    const exp = getExpirationStatus(item.expiration_date);
    if (exp === 'expired') return { label: 'Expired', tone: 'danger' as const };
    if (exp === 'today') return { label: 'Today', tone: 'danger' as const };
    if (exp === 'expiring_soon') return { label: 'Expiring Soon', tone: 'warning' as const };
    // "Fresh" is the item's condition; the filter above stays "Available"
    // because it means "not consumed or wasted", which is a different question.
    return { label: 'Fresh', tone: 'success' as const };
  };

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const badge = statusOf(item);
    const area = areas.find((a) => a.id === item.storage_area_id);
    // A consumed or wasted item is a historical record; changing its quantity
    // would rewrite what happened, so the control is withheld rather than
    // clamped to zero.
    const canStep = item.status === 'available';

    return (
      <View style={styles.rowCard}>
        <Pressable style={styles.rowMain} onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}>
          <ItemImage uri={item.image_url} category={item.category} size={52} radius={RADII.image} />
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={1}>{item.product_name}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.quantity} {item.unit}
              {item.brand ? ` · ${item.brand}` : ''}
              {area ? ` · ${area.name}` : ''}
            </Text>
            <Text style={styles.itemExpiry}>
              {item.expiration_date
                ? `${expStatusLabel(item.expiration_date)} · ${new Date(item.expiration_date).toLocaleDateString()}`
                : 'No expiration date'}
            </Text>
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </Pressable>

        {canStep && (
          <View style={styles.rowStepper}>
            <QuantityStepper
              value={item.quantity}
              unit={item.unit}
              busy={steppingId === item.id}
              compact
              onStep={(delta) => stepQuantity(item, delta)}
            />
            <Text style={styles.rowStepperHint}>Update stock</Text>
          </View>
        )}

        <View style={styles.rowActions}>
          <Pressable style={styles.rowAction} onPress={() => handleConsume(item)}>
            <Text style={styles.rowActionText}>✓ Use</Text>
          </Pressable>
          <Pressable style={styles.rowAction} onPress={() => handleDelete(item)}>
            <Text style={[styles.rowActionText, { color: COLORS.danger }]}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My Inventory</Text>
          <Text style={styles.subtitle}>{items.length} item{items.length === 1 ? '' : 's'} tracked</Text>
        </View>
        <Pressable style={styles.scanFab} onPress={() => router.push('/scan')}>
          <ScanLine size={20} color={COLORS.primary} strokeWidth={2.3} />
        </Pressable>
        <Pressable style={styles.addFab} onPress={() => router.push('/inventory/add')}>
          <Plus size={20} color={COLORS.white} strokeWidth={2.6} />
          <Text style={styles.addFabText}>Add Item</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={18} color={COLORS.secondaryText} strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search food, brand or category"
            placeholderTextColor={COLORS.secondaryText}
            returnKeyType="search"
          />
        </View>
        <Pressable style={styles.filterBtn} onPress={() => setFilter(filter === 'all' ? 'available' : 'all')}>
          <SlidersHorizontal size={18} color={COLORS.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {showAreaRow && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.areaRow}
        >
          <Chip
            label="All areas"
            active={areaFilter === 'all'}
            onPress={() => setAreaFilter('all')}
            count={areaCounts.all}
          />
          {areas.map((area) => (
            <Chip
              key={area.id}
              label={`${storageEmoji(area)} ${area.name}`}
              active={areaFilter === area.id}
              onPress={() => setAreaFilter(area.id)}
              count={areaCounts[area.id] ?? 0}
            />
          ))}
          {areaCounts.unassigned > 0 && (
            <Chip
              label="Unassigned"
              active={areaFilter === 'unassigned'}
              onPress={() => setAreaFilter('unassigned')}
              count={areaCounts.unassigned}
            />
          )}
          <Chip label="Manage areas" active={false} onPress={() => router.push('/storage-areas')} />
        </ScrollView>
      )}

      {/* A reached product limit is surfaced here rather than at the moment the
          write fails, so the user knows before they fill in a form. */}
      {!gates.addProduct.allowed && !upgradeDismissed && (
        <UpgradeNotice
          title={gates.addProduct.title}
          message={gates.addProduct.message}
          onPress={() => router.push('/subscription')}
          onDismiss={() => setUpgradeDismissed(true)}
          style={styles.notice}
        />
      )}

      {liveStatus !== null && liveStatus !== 'SUBSCRIBED' && (
        <View style={styles.offlineHint}>
          <WifiOff size={13} color={COLORS.secondaryText} strokeWidth={2} />
          <Text style={styles.offlineHintText}>Live sync paused — pull down to refresh.</Text>
        </View>
      )}

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListEmptyComponent={
          !loading ? (
            search || filter !== 'all' ? (
              <EmptyState
                icon={Search}
                title="No matching items"
                hint="Try a different search or filter."
              />
            ) : (
              <EmptyState
                icon={Package}
                title="Your inventory is empty"
                hint="Scan a product or add items manually to start tracking freshness."
                actionLabel="Add your first item"
                onAction={() => router.push('/inventory/add')}
              />
            )
          ) : null
        }
      />

      <QuantityPrompt
        visible={!!consumeTarget}
        title="Use / Consume"
        message={consumeTarget ? `How many ${consumeTarget.unit} of ${consumeTarget.product_name} did you use?` : undefined}
        unit={consumeTarget?.unit}
        max={consumeTarget?.quantity}
        confirmLabel="Consume"
        busy={busy}
        onCancel={() => setConsumeTarget(null)}
        onConfirm={confirmConsume}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  addFab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderRadius: RADII.pill,
  },
  addFabText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
  scanFab: {
    width: 46, height: 46, borderRadius: RADII.pill,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: COLORS.primary,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.white, borderRadius: RADII.input,
    borderWidth: 1, borderColor: COLORS.divider, paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.text, padding: 0 },
  filterBtn: {
    width: 46, height: 46, borderRadius: RADII.input,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  areaRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  notice: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  offlineHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm,
  },
  offlineHintText: { fontSize: 11.5, color: COLORS.secondaryText },
  rowCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  itemMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  itemExpiry: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  rowStepper: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  rowStepperHint: { fontSize: 11.5, color: COLORS.secondaryText, fontWeight: '600' },
  rowActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md,
    marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  rowAction: { paddingHorizontal: 4 },
  rowActionText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});

/**
 * How the expiry reads on a row: "Expires today", "Expires in 3d", "Expired".
 * The date itself is printed beside it, so this only has to carry the urgency.
 */
function expStatusLabel(date: string): string {
  const status = getExpirationStatus(date);
  if (status === 'expired') return 'Expired';
  if (status === 'today') return 'Expires today';
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  if (status === 'expiring_soon') return `Expires in ${days}d`;
  return 'Expires';
}
