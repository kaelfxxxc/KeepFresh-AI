import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, RefreshControl,
  KeyboardAvoidingView, Platform, TextInput, Share, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { colors, radii, spacing, shadow } from '../theme';
import { GroceryList, GroceryItem } from '../src/types';
import { ShoppingCart, Check, Plus, Trash2, Share2, Leaf, PlusCircle, ScanBarcode, Sparkles } from 'lucide-react-native';
import { NavHeader, EmptyState, HighlightCard, AIBanner, StatusPill } from '../src/components/ui';
import { categoryIcon, categoryLabel, resolveCategory } from '../src/utils/categoryIcons';
import { usePageGutter } from '../src/hooks/useContentLayout';

const peso = (n: number) => `₱${n.toFixed(2)}`;

/** The name given to the list that is created on demand. */
const DEFAULT_LIST_NAME = 'My Grocery List';

/**
 * Two lists are the same to the user when they read the same — case and
 * surrounding space do not make them distinct.
 */
const listKey = (name: string) => name.trim().toLowerCase();

export default function GroceryListScreen() {
  // The page gutter, applied to the list switcher, the items list and the
  // composer bar together so they share one left edge — and so the composer,
  // which is pinned across the full width, does not stretch away from the list
  // it belongs to on a wide screen.
  const { gutter } = usePageGutter();
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
          {item.purchased && <Check size={13} color={colors.surface} strokeWidth={3} />}
        </View>
      </Pressable>
      <View style={styles.rowMain}>
        <Text style={[styles.itemName, item.purchased && styles.itemNameOn]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>{item.quantity} {item.unit || ''}</Text>
      </View>
      <StatusPill
        status={item.purchased ? "active" : "expiringSoon"}
        label={item.purchased ? "BOUGHT" : "TO BUY"}
      />
      <Text style={[styles.price, item.purchased && styles.priceOn]} numberOfLines={1}>
        {peso(item.estimated_price || 0)}
      </Text>
      <Pressable onPress={() => deleteItem(item)} hitSlop={8}>
        <Trash2 size={16} color={colors.danger} strokeWidth={2} />
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
              <ScanBarcode size={20} color={colors.surface} strokeWidth={2.2} />
            </Pressable>
            <Pressable onPress={shareList} hitSlop={8} style={styles.headerIcon}>
              <Share2 size={20} color={colors.primary} strokeWidth={2.2} />
            </Pressable>
          </View>
        }
      />

      {/* List switcher */}
      {visibleLists.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.listChipsRow}
          contentContainerStyle={[styles.listChips, { paddingHorizontal: gutter }]}
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
            <Plus size={14} color={colors.primary} strokeWidth={2.5} />
            <Text style={styles.listChipGhostText}>New</Text>
          </Pressable>
        </ScrollView>
      )}

      {currentList ? (
        <>
          <View style={{ paddingHorizontal: gutter, marginBottom: spacing.md, gap: spacing.md }}>
            <HighlightCard
              label="Shopping list summary"
              value={`${pending.length} to buy`}
              actionLabel="Share"
              onActionPress={shareList}
              secondaryIcon={ShoppingCart}
              secondaryText={`Est. budget: ${peso(budget)}`}
              secondaryBadge={`${items.length - pending.length} done`}
            />

            <AIBanner
              icon="sparkle"
              title="Smart Depletion Alert"
              body={
                pending.length > 0
                  ? `You have ${pending.length} item${pending.length > 1 ? 's' : ''} to buy. Purchasing mindfully cuts food waste by up to 25%.`
                  : 'Your list is all checked off! Items running low in inventory will appear here.'
              }
              variant="mint"
            />
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
              contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: spacing.xl }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); fetchItems(); }} colors={[colors.primary]} tintColor={colors.primary} />}
            >
              {grouped.map((g) => {
                const GroupIcon = categoryIcon(g.category);
                return (
                  <View key={g.category} style={{ marginTop: spacing.md }}>
                    <View style={styles.groupHead}>
                      <GroupIcon size={14} color={colors.textSecondary} strokeWidth={2.4} />
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

      <View style={[styles.composeBar, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          style={styles.composeInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add an item…"
          placeholderTextColor={colors.textSecondary}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <Pressable style={[styles.addBtn, !draft.trim() && { opacity: 0.5 }]} onPress={addItem} disabled={!draft.trim()}>
          <PlusCircle size={22} color={colors.surface} strokeWidth={2.2} />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center' },
  headerScan: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  listChipsRow: { flexGrow: 0, flexShrink: 0 },
  listChips: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    alignItems: 'center',
  },
  listChip: {
    flexShrink: 0,
    justifyContent: 'center',
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listChipActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  listChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  listChipTextActive: { color: colors.surface },
  listChipGhost: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.mintBg,
  },
  listChipGhostText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  rowMain: { flex: 1, minWidth: 0 },
  emptyFill: { flex: 1, justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: spacing.sm },
  groupLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase',
    letterSpacing: 0.4, flexShrink: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkBtn: { paddingVertical: 4 },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  itemNameOn: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  price: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  priceOn: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  clearBtn: { alignSelf: 'center', paddingVertical: spacing.lg },
  clearBtnText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  composeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composeInput: {
    flex: 1,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: colors.screenBg,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  addBtnText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
});
