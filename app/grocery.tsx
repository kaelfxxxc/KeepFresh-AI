import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, RefreshControl,
  KeyboardAvoidingView, Platform, TextInput, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../src/theme';
import { GroceryList, GroceryItem } from '../src/types';
import { ShoppingCart, Check, Plus, Trash2, Share2, Leaf, PlusCircle } from 'lucide-react-native';
import { NavHeader, EmptyState } from '../src/components/ui';

const peso = (n: number) => `₱${n.toFixed(2)}`;

export default function GroceryListScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [currentList, setCurrentList] = useState<GroceryList | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);

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

  const createList = async () => {
    const { data, error } = await supabase
      .from('grocery_lists')
      .insert({ name: 'My Grocery List', user_id: profile?.id })
      .select()
      .single();
    if (error) return;
    if (data) {
      setLists((l) => [data, ...l]);
      setCurrentList(data);
      setItems([]);
    }
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

  // Group by category, unpurchased first.
  const grouped: { category: string; rows: GroceryItem[] }[] = [];
  const byCat = new Map<string, { pending: GroceryItem[]; done: GroceryItem[] }>();
  items.forEach((i) => {
    const cat = i.category || 'Other';
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
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, item.purchased && styles.itemNameOn]}>{item.name}</Text>
        <Text style={styles.itemMeta}>{item.quantity} {item.unit || ''}</Text>
      </View>
      <Text style={[styles.price, item.purchased && styles.priceOn]}>{peso(item.estimated_price || 0)}</Text>
      <Pressable onPress={() => deleteItem(item)} hitSlop={8} style={{ marginLeft: 8 }}>
        <Trash2 size={16} color={COLORS.danger} strokeWidth={2} />
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader
        title="Grocery List"
        right={
          <Pressable onPress={shareList} hitSlop={8} style={styles.headerIcon}>
            <Share2 size={20} color={COLORS.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {lists.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listChips}>
          {lists.map((l) => (
            <Pressable key={l.id} style={[styles.listChip, currentList?.id === l.id && styles.listChipActive]} onPress={() => { setCurrentList(l); }}>
              <Text style={[styles.listChipText, currentList?.id === l.id && styles.listChipTextActive]} numberOfLines={1}>
                {l.name}
              </Text>
            </Pressable>
          ))}
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
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryCount}>
                  {pending.length} item{pending.length === 1 ? '' : 's'} to buy
                </Text>
                <Text style={styles.summaryDone}>
                  {items.length - pending.length} checked off
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.budgetAmount}>{peso(budget)}</Text>
                <Text style={styles.budgetLabel}>estimated</Text>
              </View>
            </View>
          </View>

          {items.length === 0 ? (
            <EmptyState
              icon={Leaf}
              title="Nothing on this list yet"
              hint="Add items below — they'll be grouped by category."
            />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); fetchItems(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
            >
              {grouped.map((g) => (
                <View key={g.category} style={{ marginTop: SPACING.md }}>
                  <Text style={styles.groupLabel}>{g.category}</Text>
                  <View style={styles.card}>
                    {g.rows.map(renderRow)}
                  </View>
                </View>
              ))}
              <Pressable style={styles.clearBtn} onPress={clearAll}>
                <Text style={styles.clearBtnText}>Clear all items</Text>
              </Pressable>
            </ScrollView>
          )}
        </>
      ) : (
        <EmptyState
          icon={ShoppingCart}
          title="No grocery list yet"
          hint="Create a list to track what you need on your next trip."
          actionLabel="Create your first list"
          onAction={createList}
        />
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
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  listChips: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.sm },
  listChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 50, backgroundColor: COLORS.white,
    borderWidth: 1, borderColor: COLORS.divider, maxWidth: 160,
  },
  listChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  listChipText: { fontSize: 13, color: COLORS.secondaryText, fontWeight: '600' },
  listChipTextActive: { color: COLORS.white },
  listChipGhost: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 50, backgroundColor: COLORS.primaryLight },
  listChipGhostText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  summaryCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.xs, marginBottom: SPACING.sm,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryIconWrap: { width: 42, height: 42, borderRadius: RADII.icon, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  summaryCount: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  summaryDone: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  budgetAmount: { fontSize: 20, fontWeight: '800', color: COLORS.primaryDark },
  budgetLabel: { fontSize: 11, color: COLORS.secondaryText, textTransform: 'uppercase', letterSpacing: 0.3 },
  groupLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.secondaryText, textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 6, marginTop: SPACING.sm,
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
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 16,
    borderRadius: RADII.pill, backgroundColor: COLORS.primary, justifyContent: 'center',
  },
  addBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});
