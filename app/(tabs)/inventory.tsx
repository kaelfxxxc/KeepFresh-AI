import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { InventoryItem } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';
import { Search, Plus, SlidersHorizontal, Package, ScanLine } from 'lucide-react-native';
import { Chip, StatusBadge, EmptyState, ItemImage } from '../../src/components/ui';

type Filter = 'all' | 'available' | 'need_to_buy';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Available' },
  { key: 'need_to_buy', label: 'Need to Buy' },
];

export default function InventoryScreen() {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // Refetch when the tab regains focus so items added from the Scan screen (or
  // edited elsewhere) show up — with their product photo — without a manual
  // pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (profile) fetchInventory();
    }, [profile, fetchInventory])
  );

  const onRefresh = () => { setRefreshing(true); fetchInventory(); };

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

  const handleConsume = (item: InventoryItem) => {
    Alert.prompt('Consume Item', 'How many consumed?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Consume',
        onPress: async (quantityStr) => {
          const qty = parseFloat(quantityStr || '1');
          const remaining = item.quantity - qty;
          const base = { user_id: profile?.id, inventory_item_id: item.id, quantity: qty, unit: item.unit };
          if (remaining <= 0) {
            await supabase.from('inventory_items').update({ status: 'consumed' }).eq('id', item.id);
            await supabase.from('inventory_consumption').insert(base);
          } else {
            await supabase.from('inventory_items').update({ quantity: remaining }).eq('id', item.id);
            await supabase.from('inventory_consumption').insert(base);
          }
          fetchInventory();
        },
      },
    ]);
  };

  const filteredItems = items.filter((item) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q ||
      item.product_name.toLowerCase().includes(q) ||
      (item.brand || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q);
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
    return { label: 'Available', tone: 'success' as const };
  };

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const badge = statusOf(item);
    return (
      <View style={styles.rowCard}>
        <Pressable style={styles.rowMain} onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}>
          <ItemImage uri={item.image_url} category={item.category} size={52} radius={RADII.image} />
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={1}>{item.product_name}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.quantity} {item.unit}
              {item.brand ? ` · ${item.brand}` : ''}
            </Text>
            <Text style={styles.itemExpiry}>
              {item.expiration_date
                ? `Expires ${new Date(item.expiration_date).toLocaleDateString()}`
                : 'No expiration date'}
            </Text>
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </Pressable>
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
  rowCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  itemMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  itemExpiry: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  rowActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md,
    marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  rowAction: { paddingHorizontal: 4 },
  rowActionText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});
