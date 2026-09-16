import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet, Alert, RefreshControl,
  ScrollView,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { inventoryService } from '../../src/services/inventoryService';
import { storageAreaService } from '../../src/services/storageAreaService';
import { subscribeToTables, applyRealtimeEvent } from '../../src/lib/realtime';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { InventoryItem, StorageArea } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';
import { useContentLayout } from '../../src/hooks/useContentLayout';
// The one icon left on this screen. Scanning has no word that reads as a
// scanning action at a glance, so it keeps its glyph and its label together.
import { Plus, ScanLine } from 'lucide-react-native';
import {
  StatusBadge, EmptyState, ItemImage, QuantityPrompt, QuantityStepper,
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

/**
 * `'all'` and `'unassigned'` are buckets; anything else is a storage area id.
 */
type AreaFilter = 'all' | 'unassigned' | string;

/**
 * Which rows belong under a given tab.
 *
 * Takes the tab as an argument rather than reading the active one, because the
 * count beside each tab has to be worked out over *every* tab, not just the
 * selected one. Kept out of the component so both callers share one definition
 * of what each tab means.
 *
 * `history` is answered first and returns on its own, so no path below can leak
 * a consumed or wasted row into the shelf views.
 */
function matchesFilterKey(key: Filter, item: InventoryItem): boolean {
  // History is the only view that *wants* the consumed and wasted rows.
  if (key === 'history') return item.status !== 'available';

  // Need to Buy is answered before the "still on the shelf" guard below,
  // because the flag is a statement about the future rather than about stock.
  // Flagging something already used up is exactly how a user says they want it
  // again, so that row has to stay reachable from the tab that flag feeds.
  if (key === 'need_to_buy') {
    if (item.need_to_buy) return true;
    // "It ran out" only means something for an item still on the shelf: the
    // ± control floors at zero without flipping the status, so an empty packet
    // is still `available`. Consumed and wasted rows are not counted here —
    // they are gone, and every one of them would otherwise qualify.
    return item.status === 'available' && Number(item.quantity ?? 0) <= 0;
  }

  // All and Expiring describe stock in hand, so nothing historical reaches them.
  if (item.status !== 'available') return false;

  if (key === 'expiring') {
    const exp = getExpirationStatus(item.expiration_date);
    return exp === 'expired' || exp === 'today' || exp === 'expiring_soon';
  }

  return true;
}

/**
 * The filter tabs: one word per view, each with the number of items behind it.
 *
 * Plain text with an underline rather than filled chips. The row is a set of
 * views onto one list rather than a set of independent controls, and reading as
 * a tab bar is what makes that obvious — the filled pills also cost a line of
 * height that the list itself can use.
 *
 * The count comes from the caller because each tab's number is worked out over
 * the searched set without that tab applied, so the tab never advertises items
 * the search has already excluded.
 */
function FilterTabs({ active, counts, onChange, gutter }: {
  active: Filter;
  counts: Record<Filter, number>;
  onChange: (key: Filter) => void;
  gutter: number;
}) {
  return (
    <View style={[styles.tabRow, { paddingHorizontal: gutter }]}>
      {FILTERS.map((f) => {
        const selected = active === f.key;
        const count = counts[f.key] ?? 0;
        return (
          <Pressable
            key={f.key}
            onPress={() => onChange(f.key)}
            style={({ pressed }) => [styles.tab, selected && styles.tabActive, pressed && { opacity: 0.6 }]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            // Spoken as one phrase: a screen reader reading "Expiring" and then
            // a bare "3" makes the number sound like a separate element.
            accessibilityLabel={`${f.label}, ${count} item${count === 1 ? '' : 's'}`}
          >
            <Text
              style={[styles.tabLabel, selected && styles.tabLabelActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {f.label}
            </Text>
            <View style={[styles.tabCount, selected && styles.tabCountActive]}>
              <Text
                style={[styles.tabCountText, selected && styles.tabCountTextActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The storage-area filter: one chip per area, in a row that scrolls sideways.
 *
 * Scrolls rather than wraps because the number of areas is the user's to
 * decide. Wrapping turned a long list of areas into a block that pushed the
 * inventory itself down the screen; sideways, this row costs one line whatever
 * is in it, and the areas are a secondary filter that should not outgrow the
 * tabs above them.
 *
 * Text only — no emoji, no glyphs. The name of the area is the whole label.
 */
function AreaFilterRow({ chips, active, onChange, gutter }: {
  chips: { key: AreaFilter; name: string }[];
  active: AreaFilter;
  onChange: (key: AreaFilter) => void;
  gutter: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // `flexGrow: 0` keeps the row at its own height. Without it the ScrollView
      // is a flex child that will happily expand and eat the list's space.
      style={styles.areaRowScroll}
      contentContainerStyle={[styles.areaRow, { paddingHorizontal: gutter }]}
    >
      {chips.map((chip) => {
        const selected = active === chip.key;
        return (
          <Pressable
            key={chip.key}
            onPress={() => onChange(chip.key)}
            hitSlop={3}
            style={({ pressed }) => [
              styles.areaChip,
              selected && styles.areaChipActive,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text
              style={[styles.areaChipText, selected && styles.areaChipTextActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {chip.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function InventoryScreen() {
  const { profile } = useAuth();
  const { gates } = useSubscription();
  const insets = useSafeAreaInsets();

  // Everything below sizes off the width the content actually gets, not off the
  // raw screen. On a phone the outer gutter is just the usual margin; past
  // `CONTENT_MAX_WIDTH` it grows to keep the content column centred at its cap,
  // so a tablet gets a readable column instead of cards stretched edge to edge.
  // Doing it with padding rather than a wrapper View means this screen has one
  // layout container, and every row is padded to the same measure.
  //
  // The rule itself lives in the hook, shared with the Add Item form: the two
  // screens are one tap apart, and a half-inch difference in the left margin
  // between them reads as a bug.
  const { compact, contentWidth, gutter } = useContentLayout();
  // Two columns of cards once there is room for them. A single column stretched
  // across a 10" tablet is a line of text with a lot of empty space beside it.
  const listColumns = contentWidth >= 640 ? 2 : 1;
  // The bottom nav floats over this screen, so the list has to end above it.
  const { contentInset } = useFloatingTabBar();

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
      { userId: profile.id }
    );
  }, [profile, fetchAreas, steppingId]);

  const onRefresh = () => { setRefreshing(true); fetchInventory(); fetchAreas(); };

  // Applied on every change, not just on mount: arriving here already on this
  // screen with a new filter param should still move the active tab.
  useEffect(() => {
    if (FILTERS.some((f) => f.key === filterParam)) setFilter(filterParam as Filter);
  }, [filterParam]);

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

  const matchesFilter = useCallback(
    (item: InventoryItem) => matchesFilterKey(filter, item),
    [filter]
  );

  const matchesSearch = useCallback((item: InventoryItem) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return item.product_name.toLowerCase().includes(q)
      || (item.brand || '').toLowerCase().includes(q)
      || (item.category || '').toLowerCase().includes(q);
  }, [search]);

  /**
   * The storage-area chips: "All areas", one per area, then "Unassigned" when
   * something on the shelf has no home.
   *
   * Built from `items` rather than from the filtered set, so the row does not
   * grow and shrink as the tabs and the search move — a filter whose options
   * depend on the current filter is a filter the user cannot aim.
   */
  const areaChips = useMemo(() => {
    const chips = [{ key: 'all' as AreaFilter, name: 'All areas' }];
    areas.forEach((area) => chips.push({ key: area.id, name: area.name }));
    if (items.some((item) => !item.storage_area_id)) {
      chips.push({ key: 'unassigned' as AreaFilter, name: 'Unassigned' });
    }
    return chips;
  }, [areas, items]);

  /**
   * The area filter, with a guard for a selection that is no longer on the row.
   *
   * An area can be deleted from the manage screen while it is the active filter,
   * and the row would then have no chip marked active while the list stayed
   * filtered to nothing — an empty screen with no visible cause. Falling back to
   * "All areas" makes the list and the row agree again.
   */
  const areaActive: AreaFilter = areaChips.some((c) => c.key === areaFilter)
    ? areaFilter
    : 'all';

  const matchesArea = useCallback((item: InventoryItem) => {
    if (areaActive === 'all') return true;
    if (areaActive === 'unassigned') return !item.storage_area_id;
    return item.storage_area_id === areaActive;
  }, [areaActive]);

  /**
   * How many items sit behind each tab.
   *
   * Counted from the rows already in hand rather than a second round-trip, over
   * the search and the selected area but *not* through the tab's own filter — a
   * number computed with its own filter applied would just echo the list length
   * on the active tab and mean something different on every other one. The
   * question the mark answers is "how much is in there", so every tab is counted
   * over the same scoped set.
   *
   * The area is included because it scopes the list the tabs are counting: on
   * "Pantry", a tab reading 12 above a list of 4 is simply wrong. That does mean
   * the marks move when the area does, which is the honest reading — they are
   * counts within the area you are looking at.
   */
  const filterCounts = useMemo(() => {
    const scoped = items.filter((item) => matchesArea(item) && matchesSearch(item));
    const counts = {} as Record<Filter, number>;
    FILTERS.forEach((f) => {
      counts[f.key] = scoped.filter((item) => matchesFilterKey(f.key, item)).length;
    });
    return counts;
  }, [items, matchesArea, matchesSearch]);

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

  const filteredItems = items.filter(
    (item) => matchesArea(item) && matchesFilter(item) && matchesSearch(item)
  );

  const searchActive = search.trim().length > 0;

  const stockCount = items.filter((item) => item.status === 'available').length;

  const statusOf = (item: InventoryItem) => {
    if (item.status === 'consumed') {
      return { label: 'Consumed', tone: 'neutral' as const };
    }
    // Wasted is the only state here that describes something already over, and
    // it used to share the danger red with Expired and Today — the two states
    // that still want action now. It gets its own colour so a glance can tell
    // "act on this" from "this is done". The badge is text-only now, so the
    // label is what carries the state; the tint only reinforces it.
    if (item.status === 'wasted') {
      return { label: 'Wasted', tone: 'wasted' as const };
    }
    // The user's own flag outranks the freshness reading: they hearted this to
    // remember to buy more, and that is the reason it is on this screen. An item
    // the ± control has taken to zero reads the same way, because an empty
    // packet is not "fresh" in any sense the user cares about.
    if (item.need_to_buy || Number(item.quantity ?? 0) <= 0) {
      return { label: 'To Buy', tone: 'primary' as const };
    }
    const exp = getExpirationStatus(item.expiration_date);
    if (exp === 'expired') {
      return { label: 'Expired', tone: 'danger' as const };
    }
    if (exp === 'today') {
      return { label: 'Today', tone: 'danger' as const };
    }
    if (exp === 'expiring_soon') {
      return { label: 'Expiring Soon', tone: 'warning' as const };
    }
    // "Fresh" is the item's condition; the chip above stays "All" because it
    // means "everything still on the shelf", which is a different question.
    return { label: 'Fresh', tone: 'success' as const };
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
      <View style={[styles.rowCard, listColumns > 1 && styles.rowCardColumn]}>
        <Pressable style={styles.rowMain} onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}>
          <ItemImage uri={item.image_url} category={item.category} size={52} radius={RADII.image} />
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{item.product_name}</Text>
            <Text style={styles.itemMeta} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {quantity} {item.unit}
              {area ? ` · ${area.name}` : ''}
              {item.brand ? ` · ${item.brand}` : ''}
            </Text>
            {/* The date only. Urgency is the badge's job, and printing it on both
                lines said the same thing twice in a row. */}
            <Text style={styles.itemExpiry} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {item.expiration_date
                ? `Best before ${formatDayMonth(item.expiration_date)}`
                : 'No expiration date'}
            </Text>
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
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
            {/* The same flag, worded the same way, as the control on the item
                screen — one action, two places to reach it from. It stays on
                the card rather than moving into the menu: it is the only way
                into the Need to Buy chip, and burying the input to a whole
                filter behind an overflow would make that chip look broken.
                It reads as a labelled button now rather than a heart, which is
                also what a screen reader was already being told. */}
            <Pressable
              style={({ pressed }) => [
                styles.textBtn,
                item.need_to_buy && styles.textBtnActive,
                pressed && { opacity: 0.6 },
              ]}
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
              <Text
                style={[styles.textBtnLabel, item.need_to_buy && styles.textBtnLabelActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {item.need_to_buy ? 'On the list' : 'Need more'}
              </Text>
            </Pressable>

            {canStep && (
              <Pressable
                style={({ pressed }) => [styles.useBtn, pressed && { opacity: 0.75 }]}
                onPress={() => handleConsume(item)}
                hitSlop={2}
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.product_name}`}
              >
                <Text style={styles.useBtnText} maxFontSizeMultiplier={1.3}>Use</Text>
              </Pressable>
            )}

            {/* Delete and waste live in here rather than on the card face. Both
                are irreversible from this screen, and the card face is where a
                thumb rests while scrolling. */}
            <Pressable
              style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}
              onPress={() => setMenuTarget(item)}
              hitSlop={2}
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${item.product_name}`}
            >
              <Text style={styles.textBtnLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                More
              </Text>
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
      return <EmptyState title="No matching items" hint="Try a different search or filter." />;
    }
    if (filter === 'history') {
      return (
        <EmptyState
          title="Nothing in your history yet"
          hint="Items you use up or throw away are recorded here, so you can look back at what went to waste."
        />
      );
    }
    if (filter === 'need_to_buy') {
      return (
        <EmptyState
          title="Nothing to buy right now"
          hint="Flag an item as “Need more” to say you want more of it. Anything the − control has taken to zero shows up here too."
        />
      );
    }
    if (filter === 'expiring') {
      return (
        <EmptyState
          title="Nothing expiring soon"
          hint="Nothing on the shelf needs using in the next week."
        />
      );
    }
    // Only claimed on the All tab: under Expiring or Need to Buy the area may
    // well hold items, and it is the tab that has nothing to show — so those
    // keep their own message rather than blaming the area.
    if (areaActive !== 'all' && filter === 'all') {
      return (
        <EmptyState
          title="Nothing in this area"
          hint="Try another area, or pick All areas."
        />
      );
    }
    return (
      <EmptyState
        title="Your inventory is empty"
        hint="Scan a product or add items manually to start tracking freshness."
        actionLabel="Add your first item"
        onAction={() => router.push('/inventory/add')}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            My Inventory
          </Text>
          {/* Stock on the shelf, not every row ever written. Counting consumed
              and wasted items here made the headline disagree with the list
              underneath it, which shows none of them by default. */}
          <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {stockCount} item{stockCount === 1 ? '' : 's'} in stock
          </Text>
        </View>
        {/* The two actions are grouped so that when the header wraps on a narrow
            screen they move down together as one row, instead of the Add button
            orphaning itself onto a line below Scan. */}
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.push('/scan')}
            accessibilityRole="button"
            accessibilityLabel="Scan a product"
          >
            <ScanLine size={17} color={COLORS.primary} strokeWidth={2.3} />
            <Text style={styles.scanBtnText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              Scan
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.addFab, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/inventory/add')}
            accessibilityRole="button"
            accessibilityLabel="Add an item"
          >
            <Plus size={17} color={COLORS.white} strokeWidth={2.8} />
            <Text style={styles.addFabText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              Add Item
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.searchRow, { paddingHorizontal: gutter }]}>
        <View style={styles.searchBox}>
          {/* The magnifier that used to sit here is gone with the rest of the
              icons — the placeholder already says what the field is for. */}
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
            "All" and "Available" — the same state as the first two tabs, a few
            pixels below it, with no way to tell from the icon what it did. */}
      </View>

      <FilterTabs active={filter} counts={filterCounts} onChange={setFilter} gutter={gutter} />

      {/* Storage areas, under the tabs they narrow. Hidden when the only chip
          would be "All areas" — a filter row with one option is not a filter. */}
      {areaChips.length > 1 && (
        <AreaFilterRow
          chips={areaChips}
          active={areaActive}
          onChange={setAreaFilter}
          gutter={gutter}
        />
      )}

      {/* The "12 items available" line that used to sit here is gone: every tab
          carries its own number, and those marks are counted over the current
          search and area, so a total underneath them only repeated whichever tab
          was already selected. What is left of the row is the way out of a
          search — shown only while one is narrowing the list. */}
      {searchActive && (
        <View style={[styles.clearRow, { paddingHorizontal: gutter }]}>
          <Pressable
            onPress={() => setSearch('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.clearBtnText} maxFontSizeMultiplier={1.4}>Clear search</Text>
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
          style={[styles.notice, { marginHorizontal: gutter }]}
        />
      )}

      <FlatList
        // `numColumns` cannot change on a mounted list, so changing it remounts
        // the list through the key. That only happens on a rotation or a split
        // screen, where a fresh mount is cheap and a half-relaid-out list is not.
        key={`inventory-${listColumns}`}
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={listColumns}
        columnWrapperStyle={listColumns > 1 ? { gap: SPACING.sm } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: contentInset,
          gap: SPACING.sm,
        }}
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
                      danger: true,
                      onPress: () => handleMarkWaste(menuTarget),
                    }]
                  : []),
                {
                  label: 'Delete Item',
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
  // Wraps rather than shrinks: on a narrow screen the two buttons drop to a
  // second line together, which costs a few pixels of height to buy a
  // full-width title instead of an ellipsised one.
  header: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    gap: SPACING.sm, paddingBottom: SPACING.md,
  },
  headerTitleBlock: { flexGrow: 1, flexShrink: 1, minWidth: 150 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  addFab: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44,
    backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderRadius: RADII.pill,
  },
  addFabText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
  // Outlined, not filled: Scan is the secondary of the two, and it carries a
  // word as well as the glyph so the two actions are told apart by more than
  // colour and position.
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1.5, borderColor: COLORS.primary,
  },
  scanBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.white, borderRadius: RADII.input,
    borderWidth: 1, borderColor: COLORS.divider, paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.text, padding: 0 },
  // Four tabs no longer fit on one line at 375pt ("Need to Buy" is a wide
  // label), so they wrap rather than scroll. Wrapping keeps every tab visible
  // and costs nothing to lay out; a sideways strip would hide whichever filter
  // did not fit, which is the one thing a filter row must not do.
  tabRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch',
    gap: SPACING.md, marginBottom: SPACING.xs,
  },
  // The underline is drawn on the tab itself rather than as a separate rule
  // under the row, so it sits under the tab that is active wherever the row has
  // wrapped to. Transparent when inactive keeps every tab the same height, which
  // is what stops the row shifting by 2px when the selection moves.
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    // Refuses to be squeezed narrower than its label: a tab that cannot fit
    // pushes the row onto a second line instead of ellipsising "Need to Buy".
    flexShrink: 0,
    minHeight: 44,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: COLORS.primary },
  tabLabel: { fontSize: 14.5, fontWeight: '600', color: COLORS.secondaryText },
  tabLabelActive: { color: COLORS.primary, fontWeight: '800' },
  tabCount: {
    minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10,
    backgroundColor: COLORS.mutedBg,
    alignItems: 'center', justifyContent: 'center',
  },
  tabCountActive: { backgroundColor: COLORS.primaryLight },
  tabCountText: { fontSize: 11.5, fontWeight: '700', color: COLORS.secondaryText },
  tabCountTextActive: { color: COLORS.primary },
  // One line tall, and explicitly not a flex child that grows: a horizontal
  // ScrollView will otherwise stretch and take the space the list needs.
  areaRowScroll: { flexGrow: 0 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2 },
  // 38 drawn + hitSlop 3 on each side clears the 44 touch minimum without the
  // row standing taller than the tabs it sits under.
  areaChip: {
    minHeight: 38, paddingHorizontal: 14, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1, borderColor: COLORS.divider,
  },
  areaChipActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  areaChipText: { fontSize: 13, fontWeight: '600', color: COLORS.secondaryText },
  areaChipTextActive: { color: COLORS.primary, fontWeight: '700' },
  // Right-aligned, because the count it used to sit opposite is gone and the
  // control reads as an action on the search box above it.
  clearRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    marginBottom: SPACING.sm,
  },
  // Padded to a 44-high touch area even though it reads as a small text link —
  // it is the way back out of a search that found nothing, so it is worth the room.
  clearBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10, minHeight: 44,
  },
  clearBtnText: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
  notice: { marginBottom: SPACING.md },
  rowCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  // In the two-column list every cell in a row has to claim an equal share, or
  // the last card on an odd-length row sits at half width.
  rowCardColumn: { flex: 1 },
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
  // A word where a glyph used to be. 44 high clears the touch minimum on its
  // own, so these no longer need the hitSlop the 40pt icon squares relied on.
  textBtn: {
    minHeight: 44, paddingHorizontal: 8, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.divider,
  },
  textBtnActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  textBtnLabel: { fontSize: 12.5, fontWeight: '700', color: COLORS.secondaryText },
  textBtnLabelActive: { color: COLORS.primary },
  useBtn: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: 44, paddingHorizontal: 14, borderRadius: RADII.pill,
    backgroundColor: COLORS.primary,
  },
  useBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
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
