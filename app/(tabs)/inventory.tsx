import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { Search, Plus, SlidersHorizontal, Package, ScanLine, WifiOff, Heart } from 'lucide-react-native';
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
  // Deep links from elsewhere in the app open a specific chip — the dashboard's
  // "Need to Buy" shortcut lands here already filtered, rather than on "All" and
  // leaving the user to find the chip themselves.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: Filter }>();
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

  // Applied on every change, not just on mount: arriving here already on this
  // screen with a new filter param should still move the chip.
  useEffect(() => {
    if (FILTERS.some((f) => f.key === filterParam)) setFilter(filterParam as Filter);
  }, [filterParam]);

  // The location cards are hidden under Need to Buy — a location describes where
  // food *is*, and these rows are things that ran out or that the user means to
  // re-buy. A location left selected from before would then be filtering the list
  // from a control that is no longer on screen, so clear it on the way in.
  useEffect(() => {
    if (filter === 'need_to_buy') setAreaFilter('all');
  }, [filter]);

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
   * The heart: flag the item as something to buy more of, or clear the flag.
   *
   * Optimistic like the ± control, and for the same reason — it is a single
   * boolean, so waiting on the round trip would only make the tap feel broken.
   * The row is put back exactly as it was if the write fails.
   */
  const toggleNeedToBuy = useCallback(async (item: InventoryItem) => {
    const next = !item.need_to_buy;

    setItems((prev) =>
      prev.map((row) => (row.id === item.id ? { ...row, need_to_buy: next } : row))
    );

    try {
      const updated = await inventoryService.setNeedToBuy(item.id, next);
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error: any) {
      setItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
      Alert.alert(
        'Could not update Need to Buy',
        error?.message ?? 'Check your connection and try again.'
      );
    }
  }, []);

  /**
   * The chip's predicate. Kept separate from the location filter so the cards
   * below can be counted with it rather than in spite of it.
   */
  const matchesFilter = useCallback((item: InventoryItem) => {
    if (filter === 'available') return item.status === 'available';
    // The two ways an item ends up under Need to Buy: it ran out, or the user
    // hearted it to say they want more. The flag is what makes an item that is
    // still in stock show up here.
    if (filter === 'need_to_buy') {
      return item.status === 'consumed' || item.status === 'wasted' || item.need_to_buy;
    }
    return true;
  }, [filter]);

  const matchesSearch = useCallback((item: InventoryItem) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return item.product_name.toLowerCase().includes(q)
      || (item.brand || '').toLowerCase().includes(q)
      || (item.category || '').toLowerCase().includes(q);
  }, [search]);

  /**
   * How many items sit in each area. Counted from the rows we already hold
   * rather than a second round-trip, and counted *through the same predicates as
   * the list* — that is what stops a card advertising items the list below it
   * will not show. Changing the chip or the search moves the numbers with it.
   */
  const areaCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, unassigned: 0 };
    items
      .filter((item) => matchesFilter(item) && matchesSearch(item))
      .forEach((item) => {
        counts.all += 1;
        if (item.storage_area_id) {
          counts[item.storage_area_id] = (counts[item.storage_area_id] ?? 0) + 1;
        } else {
          counts.unassigned += 1;
        }
      });
    return counts;
  }, [items, matchesFilter, matchesSearch]);

  const showAreaRow = areas.length > 0 && (areas.length > 1 || areaCounts.unassigned > 0);

  /**
   * The location cards: "All areas", then one per storage area, then
   * "Unassigned" when some items have no home. Built as data so the grid below
   * stays a single uniform card rather than four near-identical blocks of JSX.
   */
  const areaCards = useMemo(() => {
    const cards = [
      { key: 'all' as AreaFilter, emoji: '🧺', name: 'All areas', count: areaCounts.all },
      ...areas.map((area) => ({
        key: area.id as AreaFilter,
        emoji: storageEmoji(area),
        name: area.name,
        count: areaCounts[area.id] ?? 0,
      })),
    ];
    if (areaCounts.unassigned > 0) {
      cards.push({
        key: 'unassigned' as AreaFilter,
        emoji: '📥',
        name: 'Unassigned',
        count: areaCounts.unassigned,
      });
    }
    return cards;
  }, [areas, areaCounts]);

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
    const matchesArea =
      areaFilter === 'all'
        ? true
        : areaFilter === 'unassigned'
          ? !item.storage_area_id
          : item.storage_area_id === areaFilter;

    return matchesArea && matchesFilter(item) && matchesSearch(item);
  });

  const statusOf = (item: InventoryItem) => {
    if (item.status === 'consumed') return { label: 'Consumed', tone: 'neutral' as const };
    if (item.status === 'wasted') return { label: 'Wasted', tone: 'danger' as const };
    // The user's own flag outranks the freshness reading: they hearted this to
    // remember to buy more, and that is the reason it is on this screen. The
    // expiry line under the name still carries the date, so nothing is lost.
    if (item.need_to_buy) return { label: 'To Buy', tone: 'primary' as const };
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
          {/* The same heart, in the same colours, as the one on the item
              screen — one control, two places to reach it from. */}
          <Pressable
            style={styles.rowHeart}
            onPress={() => toggleNeedToBuy(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: item.need_to_buy }}
            accessibilityLabel={
              item.need_to_buy
                ? `Remove ${item.product_name} from Need to Buy`
                : `Add ${item.product_name} to Need to Buy`
            }
          >
            <Heart
              size={15}
              strokeWidth={2.4}
              color={item.need_to_buy ? COLORS.danger : COLORS.secondaryText}
              fill={item.need_to_buy ? COLORS.danger : 'transparent'}
            />
          </Pressable>
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

      {/* Location cards. Three to a row, each the same size, and they wrap
          instead of scrolling sideways — a horizontal strip could not give the
          cards equal widths without measuring the screen, and it hid whichever
          areas did not fit. Hidden under Need to Buy: nothing there is in a
          fridge. */}
      {showAreaRow && filter !== 'need_to_buy' && (
        <View style={styles.areaGrid}>
          {areaCards.map((card) => {
            const active = areaFilter === card.key;
            return (
              <Pressable
                key={card.key}
                style={[styles.areaCard, active && styles.areaCardActive]}
                onPress={() => setAreaFilter(card.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.areaCardEmoji}>{card.emoji}</Text>
                <Text style={[styles.areaCardName, active && styles.areaCardTextActive]} numberOfLines={1}>
                  {card.name}
                </Text>
                <Text style={[styles.areaCardCount, active && styles.areaCardTextActive]}>
                  {card.count} {card.count === 1 ? 'item' : 'items'}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            style={[styles.areaCard, styles.areaCardManage]}
            onPress={() => router.push('/storage-areas')}
            accessibilityRole="button"
            accessibilityLabel="Manage storage areas"
          >
            <Text style={styles.areaCardEmoji}>⚙️</Text>
            <Text style={[styles.areaCardName, styles.areaCardMuted]} numberOfLines={1}>Manage</Text>
            <Text style={[styles.areaCardCount, styles.areaCardMuted]}>areas</Text>
          </Pressable>
        </View>
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
            filter === 'need_to_buy' && !search ? (
              // Empty on this chip is not a failed search — it is the normal
              // starting state, so the hint explains the two ways in rather than
              // telling the user to adjust a filter that is working correctly.
              <EmptyState
                icon={Heart}
                title="Nothing to buy right now"
                hint="Heart an item to say you want more of it, or use one up — either way it turns up here."
              />
            ) : search || filter !== 'all' ? (
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
  areaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    // Makes every card on a line exactly as tall as the tallest on that line.
    // With one line of name and one of count in each card, every card in the
    // grid ends up the same height rather than only the ones side by side.
    alignItems: 'stretch',
  },
  areaCard: {
    // Three to a row. A 30% base plus `flexShrink: 0` is what keeps the widths
    // identical: nothing can be squeezed narrower than its share, and three of
    // them always fit because 3 × 30% + two gaps is under 100% at any screen
    // width. `flexGrow` then shares out what is left so the row ends flush, and
    // `maxWidth` keeps a final card that wrapped on its own from stretching
    // across the whole screen.
    flexBasis: '30%',
    flexGrow: 1,
    flexShrink: 0,
    maxWidth: '33%',
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.white,
  },
  areaCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  areaCardManage: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  // Explicit line heights on all three lines: emoji metrics differ between iOS
  // and Android, and without this the cards in a row grew to different heights.
  areaCardEmoji: { fontSize: 20, lineHeight: 24 },
  areaCardName: { fontSize: 12.5, lineHeight: 16, fontWeight: '700', color: COLORS.text, maxWidth: '100%' },
  areaCardCount: { fontSize: 11, lineHeight: 14, color: COLORS.secondaryText },
  areaCardTextActive: { color: COLORS.white },
  areaCardMuted: { color: COLORS.secondaryText },
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
  rowHeart: { paddingHorizontal: 4, paddingVertical: 2 },
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
