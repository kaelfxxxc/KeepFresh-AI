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
import {
  Search, Plus, Package, ScanLine, WifiOff, Heart, MoreHorizontal, Trash2,
  AlertTriangle, Clock, CheckCircle2, Check, History, X,
} from 'lucide-react-native';
import {
  Chip, StatusBadge, EmptyState, ItemImage, QuantityPrompt, QuantityStepper,
  UpgradeNotice, ActionMenu,
} from '../../src/components/ui';

/**
 * What the list is showing.
 *
 * `history` is the odd one out — it is the only value that describes items the
 * user no longer has. Everything else narrows the stock still on the shelf, and
 * none of them will surface a consumed or wasted row. Keeping those out of the
 * default view is the point: an item that was eaten last week is not something
 * the user can act on today, and mixing the two made the list read as a log
 * rather than a shelf.
 */
type Filter = 'all' | 'expiring' | 'need_to_buy' | 'history';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'need_to_buy', label: 'Need to Buy' },
  { key: 'history', label: 'History' },
];

/** Filters that describe nothing physical, so the location cards are hidden. */
const AREALESS: Filter[] = ['need_to_buy', 'history'];

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
  const [menuTarget, setMenuTarget] = useState<InventoryItem | null>(null);
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

  // The location cards are hidden under Need to Buy and History — a location
  // describes where food *is*, and one of those chips is things to re-buy while
  // the other is things already gone. A location left selected from before would
  // then be filtering the list from a control that is no longer on screen, so
  // clear it on the way in.
  useEffect(() => {
    if (AREALESS.includes(filter)) setAreaFilter('all');
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
      if (delta < 0 && Number(item.quantity ?? 0) <= 0) return;

      setSteppingId(item.id);
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            // `Number(...)` because the column is NUMERIC, which arrives as a
            // string over some PostgREST configurations — and `"5" + 1` is "51",
            // not 6. The rest of the app coerces the same way.
            ? { ...row, quantity: Math.max(Number(row.quantity ?? 0) + delta, 0) }
            : row
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
   *
   * `history` is answered first and returns on its own, so no path below can
   * leak a consumed or wasted row into the shelf views.
   */
  const matchesFilter = useCallback((item: InventoryItem) => {
    // History is the only view that *wants* the consumed and wasted rows.
    if (filter === 'history') return item.status !== 'available';

    // Need to Buy is answered before the "still on the shelf" guard below,
    // because the flag is a statement about the future rather than about stock.
    // Hearting something already used up is exactly how a user says they want it
    // again, so that row has to stay reachable from the chip the heart feeds.
    if (filter === 'need_to_buy') {
      if (item.need_to_buy) return true;
      // "It ran out" only means something for an item still on the shelf: the
      // ± control floors at zero without flipping the status, so an empty packet
      // is still `available`. Consumed and wasted rows are not counted here —
      // they are gone, and every one of them would otherwise qualify.
      return item.status === 'available' && Number(item.quantity ?? 0) <= 0;
    }

    // All and Expiring describe stock in hand, so nothing historical reaches them.
    if (item.status !== 'available') return false;

    if (filter === 'expiring') {
      const exp = getExpirationStatus(item.expiration_date);
      return exp === 'expired' || exp === 'today' || exp === 'expiring_soon';
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

  const showAreaRow =
    !AREALESS.includes(filter) &&
    areas.length > 0 &&
    (areas.length > 1 || areaCounts.unassigned > 0);

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

  /**
   * Permanently remove an item.
   *
   * Goes through the service rather than hitting the table here, so this screen
   * is not the one place that skips the layer — and so a failure to delete is
   * reported instead of leaving the row on screen with no explanation.
   *
   * Note what this destroys: `inventory_consumption` and `food_waste` both
   * cascade from `inventory_items`, so deleting an item also removes its
   * consumption and waste records, which retroactively changes past analytics
   * and waste reports. That is why this stays behind a confirmation and off the
   * card face — an undo here could not put those records back.
   */
  const handleDelete = (item: InventoryItem) => {
    Alert.alert('Delete Item', `Are you sure you want to remove "${item.product_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await inventoryService.deleteInventoryItem(item.id);
            setItems((prev) => prev.filter((row) => row.id !== item.id));
            fetchInventory();
          } catch (error: any) {
            Alert.alert('Could not delete item', error?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  /**
   * Write the item off as thrown away.
   *
   * Two writes that mirror the item screen: a record in `food_waste` for the
   * waste report, then the status flip that moves the item out of the shelf
   * views and into History. The waste record carries the item's value so the
   * report can price what was lost.
   */
  const handleMarkWaste = (item: InventoryItem) => {
    if (!profile) return;
    Alert.alert('Mark as Waste', `Record "${item.product_name}" as thrown away?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as Waste', style: 'destructive',
        onPress: async () => {
          try {
            await supabase.from('food_waste').insert({
              user_id: profile.id,
              inventory_item_id: item.id,
              quantity: item.quantity,
              unit: item.unit,
              reason: 'User marked as waste',
              estimated_value: item.price ? item.price * Number(item.quantity) : 0,
            });
            await inventoryService.updateInventoryItem(item.id, { status: 'wasted' });
            fetchInventory();
          } catch (error: any) {
            Alert.alert('Could not record waste', error?.message ?? 'Please try again.');
          }
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

  /**
   * The line above the list: what is being shown, and how much of it.
   *
   * The chips and the location cards each mark themselves active, but neither
   * says what the *combination* means — and the two really do stack, which is
   * not obvious from two independent rows of controls. Spelling it out as a
   * sentence, and offering one control that clears all of it, is what makes the
   * filters read as additive rather than as one resetting the other.
   */
  const areaLabel = areaFilter === 'all'
    ? null
    : areaFilter === 'unassigned'
      ? 'Unassigned'
      : areas.find((a) => a.id === areaFilter)?.name ?? null;

  const appliedFilters = [
    FILTERS.find((f) => f.key === filter)?.label ?? 'All',
    areaLabel,
  ].filter(Boolean).join(' · ');

  const filtersActive = filter !== 'all' || areaFilter !== 'all' || search.trim().length > 0;

  const clearFilters = () => {
    setFilter('all');
    setAreaFilter('all');
    setSearch('');
  };

  const stockCount = items.filter((item) => item.status === 'available').length;

  const statusOf = (item: InventoryItem) => {
    if (item.status === 'consumed') {
      return { label: 'Consumed', tone: 'neutral' as const, icon: Check };
    }
    // Wasted is the only state here that describes something already over, and
    // it used to share the danger red with Expired and Today — the two states
    // that still want action now. It gets its own colour so a glance can tell
    // "act on this" from "this is done", and every badge carries an icon as well
    // as a label, so the state never rests on hue alone.
    if (item.status === 'wasted') {
      return { label: 'Wasted', tone: 'wasted' as const, icon: Trash2 };
    }
    // The user's own flag outranks the freshness reading: they hearted this to
    // remember to buy more, and that is the reason it is on this screen. An item
    // the ± control has taken to zero reads the same way, because an empty
    // packet is not "fresh" in any sense the user cares about.
    if (item.need_to_buy || Number(item.quantity ?? 0) <= 0) {
      return { label: 'To Buy', tone: 'primary' as const, icon: Heart };
    }
    const exp = getExpirationStatus(item.expiration_date);
    if (exp === 'expired') {
      return { label: 'Expired', tone: 'danger' as const, icon: AlertTriangle };
    }
    if (exp === 'today') {
      return { label: 'Today', tone: 'danger' as const, icon: Clock };
    }
    if (exp === 'expiring_soon') {
      return { label: 'Expiring Soon', tone: 'warning' as const, icon: Clock };
    }
    // "Fresh" is the item's condition; the chip above stays "All" because it
    // means "everything still on the shelf", which is a different question.
    return { label: 'Fresh', tone: 'success' as const, icon: CheckCircle2 };
  };

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const badge = statusOf(item);
    const area = areas.find((a) => a.id === item.storage_area_id);
    // A consumed or wasted item is a historical record; changing its quantity
    // would rewrite what happened, so the stepper is withheld rather than
    // clamped to zero. Its heart and its ⋯ menu stay: both are still meaningful
    // statements about an item that is gone.
    const canStep = item.status === 'available';
    const quantity = Number(item.quantity ?? 0);

    return (
      <View style={styles.rowCard}>
        <Pressable style={styles.rowMain} onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}>
          <ItemImage uri={item.image_url} category={item.category} size={52} radius={RADII.image} />
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={1}>{item.product_name}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {quantity} {item.unit}
              {area ? ` · ${area.name}` : ''}
              {item.brand ? ` · ${item.brand}` : ''}
            </Text>
            {/* The date only. Urgency is the badge's job, and printing it on both
                lines said the same thing twice in a row. */}
            <Text style={styles.itemExpiry} numberOfLines={1}>
              {item.expiration_date
                ? `Best before ${formatDayMonth(item.expiration_date)}`
                : 'No expiration date'}
            </Text>
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} icon={badge.icon} />
        </Pressable>

        {/* One row, not two: the stepper and the actions answer the same
            question ("do something with this item"), and stacking them with a
            rule between cost every card a line of height for nothing. */}
        <View style={styles.rowFooter}>
          {canStep ? (
            <QuantityStepper
              value={quantity}
              unit={item.unit}
              busy={steppingId === item.id}
              compact
              onStep={(delta) => stepQuantity(item, delta)}
            />
          ) : (
            <View />
          )}

          <View style={styles.rowActions}>
            {/* The same heart, in the same colours, as the one on the item
                screen — one control, two places to reach it from. It stays on
                the card rather than moving into the menu: it is the only way
                into the Need to Buy chip, and burying the input to a whole
                filter behind an overflow would make that chip look broken. */}
            <Pressable
              style={({ pressed }) => [styles.rowIconBtn, pressed && { opacity: 0.6 }]}
              onPress={() => toggleNeedToBuy(item)}
              hitSlop={2}
              accessibilityRole="button"
              accessibilityState={{ selected: item.need_to_buy }}
              accessibilityLabel={
                item.need_to_buy
                  ? `Remove ${item.product_name} from Need to Buy`
                  : `Add ${item.product_name} to Need to Buy`
              }
            >
              <Heart
                size={19}
                strokeWidth={2.4}
                color={item.need_to_buy ? COLORS.danger : COLORS.secondaryText}
                fill={item.need_to_buy ? COLORS.danger : 'transparent'}
              />
            </Pressable>

            {canStep && (
              <Pressable
                style={({ pressed }) => [styles.useBtn, pressed && { opacity: 0.75 }]}
                onPress={() => handleConsume(item)}
                hitSlop={2}
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.product_name}`}
              >
                <CheckCircle2 size={15} color={COLORS.white} strokeWidth={2.6} />
                <Text style={styles.useBtnText}>Use</Text>
              </Pressable>
            )}

            {/* Delete and waste live in here rather than on the card face. Both
                are irreversible from this screen, and the card face is where a
                thumb rests while scrolling. */}
            <Pressable
              style={({ pressed }) => [styles.rowIconBtn, pressed && { opacity: 0.6 }]}
              onPress={() => setMenuTarget(item)}
              hitSlop={2}
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${item.product_name}`}
            >
              <MoreHorizontal size={20} color={COLORS.secondaryText} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  /**
   * The empty list, in the user's terms.
   *
   * A blank list means something different on each chip, and only one of these
   * is a problem to fix. "Nothing expiring soon" is good news and should read
   * that way; an empty History is simply a young account. Only an unfiltered
   * empty list is the state that wants the Add button.
   */
  const emptyState = () => {
    if (search.trim()) {
      return <EmptyState icon={Search} title="No matching items" hint="Try a different search or filter." />;
    }
    if (filter === 'history') {
      return (
        <EmptyState
          icon={History}
          title="Nothing in your history yet"
          hint="Items you use up or throw away are recorded here, so you can look back at what went to waste."
        />
      );
    }
    if (filter === 'need_to_buy') {
      return (
        <EmptyState
          icon={Heart}
          title="Nothing to buy right now"
          hint="Heart an item to say you want more of it. Anything the − control has taken to zero shows up here too."
        />
      );
    }
    if (filter === 'expiring') {
      return (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing expiring soon"
          hint="Nothing on the shelf needs using in the next week."
        />
      );
    }
    if (areaFilter !== 'all') {
      return (
        <EmptyState
          icon={Package}
          title="Nothing in this area"
          hint="Try another location, or clear the filter."
        />
      );
    }
    return (
      <EmptyState
        icon={Package}
        title="Your inventory is empty"
        hint="Scan a product or add items manually to start tracking freshness."
        actionLabel="Add your first item"
        onAction={() => router.push('/inventory/add')}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My Inventory</Text>
          {/* Stock on the shelf, not every row ever written. Counting consumed
              and wasted items here made the headline disagree with the list
              underneath it, which shows none of them by default. */}
          <Text style={styles.subtitle}>{stockCount} item{stockCount === 1 ? '' : 's'} in stock</Text>
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
        {/* The sliders button that used to sit here toggled the list between
            "All" and "Available" — the same state as the first two chips, a few
            pixels below it, with no way to tell from the icon what it did. */}
      </View>

      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {/* What the active combination adds up to. Shown always, because the count
          alone is useful, but the Clear control only appears once there is
          something to clear. */}
      <View style={styles.filterStatusRow}>
        <Text style={styles.filterStatusText} numberOfLines={1}>
          {appliedFilters} · {filteredItems.length} item{filteredItems.length === 1 ? '' : 's'}
        </Text>
        {filtersActive && (
          <Pressable
            onPress={clearFilters}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters and search"
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}
          >
            <X size={13} color={COLORS.primary} strokeWidth={2.8} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>

      {/* Location cards. Three to a row, each the same size, and they wrap
          instead of scrolling sideways — a horizontal strip could not give the
          cards equal widths without measuring the screen, and it hid whichever
          areas did not fit. Hidden under Need to Buy and History: one is things
          to re-buy, the other things already gone, and neither is in a fridge. */}
      {showAreaRow && (
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
        ListEmptyComponent={!loading ? emptyState() : null}
      />

      <ActionMenu
        visible={!!menuTarget}
        title={menuTarget?.product_name}
        onClose={() => setMenuTarget(null)}
        actions={
          menuTarget
            ? [
                // Only offered while there is something left to throw away.
                ...(menuTarget.status === 'available'
                  ? [{
                      label: 'Mark as Waste',
                      icon: Trash2,
                      danger: true,
                      onPress: () => handleMarkWaste(menuTarget),
                    }]
                  : []),
                {
                  label: 'Delete Item',
                  icon: Trash2,
                  danger: true,
                  onPress: () => handleDelete(menuTarget),
                },
              ]
            : []
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
  // Four chips no longer fit on one line at 375pt ("Need to Buy" is a wide
  // label), so they wrap rather than scroll. Wrapping keeps every chip visible
  // and costs nothing to lay out; a sideways strip would hide whichever filter
  // did not fit, which is the one thing a filter row must not do.
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm,
  },
  filterStatusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md,
  },
  filterStatusText: { flex: 1, fontSize: 12, color: COLORS.secondaryText, fontWeight: '600' },
  // Padded to a 44-high touch area even though it reads as a small text link —
  // it is the escape hatch out of a filtered list, so it is worth the room.
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, minHeight: 44,
  },
  clearBtnText: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
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
  // The stepper and the actions share one line. `flexWrap` is the safety valve
  // for a narrow screen or a large accessibility font: rather than clipping a
  // control, the row drops the actions onto a second line.
  rowFooter: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACING.sm, marginTop: SPACING.sm,
  },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginLeft: 'auto' },
  // 40 drawn + hitSlop 2 on each side = the 44 minimum, without the visual
  // weight of a 44px square for what is a secondary icon action.
  rowIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  useBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    minHeight: 40, paddingHorizontal: 14, borderRadius: RADII.pill,
    backgroundColor: COLORS.primary,
  },
  useBtnText: { fontSize: 13.5, fontWeight: '700', color: COLORS.white },
});

/**
 * "24 Sep" — the expiry date on a card.
 *
 * Parsed from the date parts rather than through `new Date(...)`, because the
 * column is a DATE with no time: `new Date('2026-09-24')` is UTC midnight, which
 * renders as the 23rd anywhere west of Greenwich. Reading the parts and building
 * a local date keeps the card showing the day that was actually stored.
 */
function formatDayMonth(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
