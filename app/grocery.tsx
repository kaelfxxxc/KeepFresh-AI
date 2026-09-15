import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, RefreshControl,
  KeyboardAvoidingView, Platform, TextInput, Share, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../src/theme';
import { GroceryList, GroceryItem } from '../src/types';
import { ShoppingCart, Check, Plus, Trash2, Share2, Leaf, PlusCircle, ScanBarcode } from 'lucide-react-native';
import { NavHeader, EmptyState } from '../src/components/ui';
import { categoryIcon, categoryLabel, resolveCategory } from '../src/utils/categoryIcons';

const peso = (n: number) => `₱${n.toFixed(2)}`;

/** The name given to the list that is created on demand. */
const DEFAULT_LIST_NAME = 'My Grocery List';

/**
 * Two lists are the same to the user when they read the same — case and
 * surrounding space do not make them distinct.
 */
const listKey = (name: string) => name.trim().toLowerCase();

export default function GroceryListScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [currentList, setCurrentList] = useState<GroceryList | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();

  /**
   * What the chip row shows: one entry per distinct name.
   *
   * Accounts in the wild already hold duplicates from the unconditional insert
   * this screen used to do, and a duplicate row is invisible to the user as a
   * row — it only ever looks like the same list printed twice. Collapsing by
   * name on the way to the screen fixes that for those accounts without
   * deleting anything, and keeps the current selection valid because the
   * surviving entry is the same record the user was already on.
   */
  const visibleLists = useMemo(() => {
    const seen = new Set<string>();
    return lists.filter((l) => {
      const key = listKey(l.name ?? '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lists]);

  // A chip stays a chip: wide enough for a name, never wide enough to become
  // the whole row. Proportional so it holds up from a small phone upward.
  const chipMaxWidth = Math.min(200, Math.round(width * 0.45));

  // If the selected list was one of the collapsed duplicates, move to the entry
  // that survived rather than leaving the screen pointed at a row the chip row
  // no longer shows.
  useEffect(() => {
    if (visibleLists.length === 0) return;
    if (currentList && visibleLists.some((l) => l.id === currentList.id)) return;
    setCurrentList(visibleLists[0]);
  }, [visibleLists, currentList]);

  const fetchLists = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('grocery_lists')
      .select('*')
      .eq('user_id', profile.id)
      .order('updated_at', { ascending: false });
    if (data) {
      setLists(data);
      setCurrentList((cur) => cur || data[0] || null);
    }
    setRefreshing(false);
  }, [profile]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  const fetchItems = useCallback(async (listId?: string) => {
    const id = listId || currentList?.id;
    if (!id) return;
    const { data } = await supabase
      .from('grocery_items')
      .select('*')
      .eq('grocery_list_id', id)
      .order('created_at', { ascending: true });
    if (data) setItems(data);
  }, [currentList?.id]);

  useEffect(() => { if (currentList) fetchItems(currentList.id); }, [currentList?.id, fetchItems]);

  // Scanning pushes /grocery/scan on top of this screen and adds the item
  // there, so the list has to be re-read when it comes back into focus.
  useFocusEffect(
    useCallback(() => {
      fetchLists();
      if (currentList?.id) fetchItems(currentList.id);
      // fetchItems already tracks the current list id.
    }, [fetchLists, fetchItems, currentList?.id])
  );

  /**
   * Get the default list, creating it only if it is genuinely missing.
   *
   * This used to insert unconditionally, so every press of "New" (and every
   * scanner launch) added another row called "My Grocery List". Three taps left
   * three identical lists that the screen rendered as three identical cards.
   * Reusing the existing row makes the call idempotent, which is what the
   * scanner needs anyway — it wants "a list to add to", not "a new list".
   */
  const createList = async (): Promise<GroceryList | null> => {
    const existing = lists.find((l) => l.name === DEFAULT_LIST_NAME);
    if (existing) {
      setCurrentList(existing);
      return existing;
    }

    const { data, error } = await supabase
      .from('grocery_lists')
      .insert({ name: DEFAULT_LIST_NAME, user_id: profile?.id })
      .select()
      .single();
    if (error) return null;
    if (data) {
      setLists((l) => [data, ...l]);
      setCurrentList(data);
      setItems([]);
    }
    return data ?? null;
  };

  const addItem = async () => {
    const name = draft.trim();
    if (!name || !currentList) return;
    const { error } = await supabase.from('grocery_items').insert({
      name, grocery_list_id: currentList.id, purchased: false, quantity: 1, unit: 'pcs',
    });
    if (!error) {
      setDraft('');
      fetchItems(currentList.id);
    }
  };

  const togglePurchased = async (item: GroceryItem) => {
    await supabase.from('grocery_items').update({ purchased: !item.purchased }).eq('id', item.id);
    fetchItems(currentList?.id);
  };

  const deleteItem = async (item: GroceryItem) => {
    await supabase.from('grocery_items').delete().eq('id', item.id);
    fetchItems(currentList?.id);
  };

  const clearAll = async () => {
    if (!currentList) return;
    await supabase.from('grocery_items').delete().eq('grocery_list_id', currentList.id);
    fetchItems(currentList.id);
  };

  const pending = items.filter((i) => !i.purchased);
  const budget = pending.reduce((s, i) => s + (i.estimated_price || 0), 0);

  const shareList = async () => {
    const rows = items.map((i) => `${i.purchased ? '[x]' : '[ ]'} ${i.name}${i.estimated_price ? ` — ${peso(i.estimated_price)}` : ''}`).join('\n');
    try {
      await Share.share({
        message: `${currentList?.name || 'Grocery List'}\n\n${rows || 'No items yet.'}`,
      });
    } catch (e) {
      /* user dismissed */
    }
  };

  // Scanning needs a list to add to. On a fresh account the scanner would have
  // nowhere to put the item, so a list is created first rather than leaving a
  // dead end behind the button.
  const openScanner = async () => {
    const list = currentList ?? (await createList());
    if (!list) return;
    router.push({
      pathname: '/grocery/scan',
      params: { listId: list.id, listName: list.name },
    });
  };

  // Group by category, unpurchased first.
  //
  // Rows are bucketed by the *resolved* category rather than the raw stored
  // string, so the old Title Case rows and the canonical keys the scanner now
  // writes land in the same group instead of splitting one aisle into two.
  const grouped: { category: string; rows: GroceryItem[] }[] = [];
  const byCat = new Map<string, { pending: GroceryItem[]; done: GroceryItem[] }>();
  items.forEach((i) => {
    const cat = resolveCategory(i.category);
    if (!byCat.has(cat)) byCat.set(cat, { pending: [], done: [] });
    const bucket = byCat.get(cat)!;
    (i.purchased ? bucket.done : bucket.pending).push(i);
  });
  byCat.forEach((b, cat) => grouped.push({ category: cat, rows: [...b.pending, ...b.done] }));

  const renderRow = (item: GroceryItem) => (
    <View key={item.id} style={styles.row}>
      <Pressable style={styles.checkBtn} onPress={() => togglePurchased(item)} hitSlop={8}>
        <View style={[styles.check, item.purchased && styles.checkOn]}>
          {item.purchased && <Check size={13} color={COLORS.white} strokeWidth={3} />}
        </View>
      </Pressable>
      {/* The name is the only part of the row allowed to give way. Without a
          line limit it wraps instead of shrinking, and a grocery name long
          enough to wrap takes the row height with it while shoving the price
          and the delete button off the right edge. */}
      <View style={styles.rowMain}>
        <Text style={[styles.itemName, item.purchased && styles.itemNameOn]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>{item.quantity} {item.unit || ''}</Text>
      </View>
      <Text style={[styles.price, item.purchased && styles.priceOn]} numberOfLines={1}>
        {peso(item.estimated_price || 0)}
      </Text>
      <Pressable onPress={() => deleteItem(item)} hitSlop={8}>
        <Trash2 size={16} color={COLORS.danger} strokeWidth={2} />
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader
        title="Grocery List"
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={openScanner}
              hitSlop={8}
              accessibilityLabel="Scan a product into this list"
              style={styles.headerScan}
            >
              <ScanBarcode size={20} color={COLORS.white} strokeWidth={2.2} />
            </Pressable>
            <Pressable onPress={shareList} hitSlop={8} style={styles.headerIcon}>
              <Share2 size={20} color={COLORS.primary} strokeWidth={2.2} />
            </Pressable>
          </View>
        }
      />

      {/* List switcher. Only worth a row when there is genuinely more than one
          list to switch between, and only ever one chip per name. */}
      {visibleLists.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.listChipsRow}
          contentContainerStyle={styles.listChips}
          keyboardShouldPersistTaps="handled"
        >
          {visibleLists.map((l) => {
            const active = currentList?.id === l.id;
            return (
              <Pressable
                key={l.id}
                onPress={() => setCurrentList(l)}
                style={[styles.listChip, { maxWidth: chipMaxWidth }, active && styles.listChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.listChipText, active && styles.listChipTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {l.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable style={styles.listChipGhost} onPress={createList} hitSlop={6}>
            <Plus size={14} color={COLORS.primary} strokeWidth={2.5} />
            <Text style={styles.listChipGhostText}>New</Text>
          </Pressable>
        </ScrollView>
      )}

      {currentList ? (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryIconWrap}>
                <ShoppingCart size={20} color={COLORS.primary} strokeWidth={2.2} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.summaryCount} numberOfLines={1}>
                  {pending.length} item{pending.length === 1 ? '' : 's'} to buy
                </Text>
                <Text style={styles.summaryDone} numberOfLines={1}>
                  {items.length - pending.length} checked off
                </Text>
              </View>
              <View style={styles.budgetBlock}>
                <Text style={styles.budgetAmount} numberOfLines={1}>{peso(budget)}</Text>
                <Text style={styles.budgetLabel}>estimated</Text>
              </View>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyFill}>
              <EmptyState
                compact
                icon={Leaf}
                title="Nothing on this list yet"
                hint="Add items below, or scan a barcode — they'll be grouped by category."
              />
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); fetchItems(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
            >
              {grouped.map((g) => {
                const GroupIcon = categoryIcon(g.category);
                return (
                  <View key={g.category} style={{ marginTop: SPACING.md }}>
                    <View style={styles.groupHead}>
                      <GroupIcon size={13} color={COLORS.secondaryText} strokeWidth={2.4} />
                      <Text style={styles.groupLabel} numberOfLines={1}>{categoryLabel(g.category)}</Text>
                    </View>
                    <View style={styles.card}>
                      {g.rows.map(renderRow)}
                    </View>
                  </View>
                );
              })}
              <Pressable style={styles.clearBtn} onPress={clearAll}>
                <Text style={styles.clearBtnText}>Clear all items</Text>
              </Pressable>
            </ScrollView>
          )}
        </>
      ) : (
        <View style={styles.emptyFill}>
          <EmptyState
            compact
            icon={ShoppingCart}
            title="No grocery list yet"
            hint="Create a list to track what you need on your next trip."
            actionLabel="Create your first list"
            onAction={createList}
          />
        </View>
      )}

      <View style={[styles.composeBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TextInput
          style={styles.composeInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add an item…"
          placeholderTextColor={COLORS.secondaryText}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <Pressable style={[styles.addBtn, !draft.trim() && { opacity: 0.5 }]} onPress={addItem} disabled={!draft.trim()}>
          <PlusCircle size={22} color={COLORS.white} strokeWidth={2.2} />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  headerScan: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  // `flexGrow: 0` is the whole fix for the bloated look: a horizontal ScrollView
  // is a direct child of this screen's flex column, and with no height of its
  // own it is free to stretch vertically. Left unconstrained it pushed the
  // summary card and the list down the screen.
  listChipsRow: { flexGrow: 0, flexShrink: 0 },
  listChips: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
    alignItems: 'center',
  },
  listChip: {
    // Chips sit on one line and keep their own width; the row scrolls instead
    // of the chips stretching to fill it.
    flexShrink: 0,
    justifyContent: 'center',
    height: 34,
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  listChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  listChipText: { fontSize: 13, color: COLORS.secondaryText, fontWeight: '600' },
  listChipTextActive: { color: COLORS.white },
  listChipGhost: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.primaryLight,
  },
  listChipGhostText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  summaryCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.xs, marginBottom: SPACING.sm,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The one column that absorbs whatever width is left. `minWidth: 0` is what
  // lets it actually shrink — without it a long string sets the column's floor
  // and the fixed-width things beside it get pushed off the screen.
  rowMain: { flex: 1, minWidth: 0 },
  // The amount is money: it reads as a unit, so it keeps its intrinsic width
  // rather than being squeezed, and the column beside it truncates instead.
  budgetBlock: { alignItems: 'flex-end', flexShrink: 0 },
  // Holds the empty-list placeholder in the space between the summary card and
  // the compose bar, so shrinking it does not just leave a larger gap behind.
  emptyFill: { flex: 1, justifyContent: 'center' },
  summaryIconWrap: { width: 42, height: 42, borderRadius: RADII.icon, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  summaryCount: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  summaryDone: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  budgetAmount: { fontSize: 20, fontWeight: '800', color: COLORS.primaryDark },
  budgetLabel: { fontSize: 11, color: COLORS.secondaryText, textTransform: 'uppercase', letterSpacing: 0.3 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6, marginTop: SPACING.sm },
  groupLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.secondaryText, textTransform: 'uppercase',
    letterSpacing: 0.4, flexShrink: 1,
  },
  card: { backgroundColor: COLORS.white, borderRadius: RADII.card, paddingHorizontal: SPACING.md, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: COLORS.divider, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  checkOn: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  checkBtn: { paddingVertical: 4 },
  itemName: { fontSize: 15, fontWeight: '500', color: COLORS.text },
  itemNameOn: { color: COLORS.secondaryText, textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  price: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  priceOn: { color: COLORS.secondaryText, textDecorationLine: 'line-through' },
  clearBtn: { alignSelf: 'center', paddingVertical: SPACING.md },
  clearBtnText: { color: COLORS.danger, fontSize: 13, fontWeight: '700' },
  composeBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  composeInput: {
    flex: 1, height: 44, borderRadius: RADII.input, backgroundColor: COLORS.mutedBg,
    paddingHorizontal: 14, fontSize: 15, color: COLORS.text,
    // A fixed height plus Android's default font padding squeezes the text box,
    // so the placeholder rendered clipped / off-centre there while looking fine
    // on iOS. Reset the vertical padding and centre the text explicitly to get
    // the same result on both platforms. (`padding: 0` in inventory.tsx is the
    // same workaround for its search field.)
    paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center',
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 16,
    borderRadius: RADII.pill, backgroundColor: COLORS.primary, justifyContent: 'center',
  },
  addBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});
