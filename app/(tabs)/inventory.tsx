import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, FONTS } from '../../src/theme';
import { InventoryItem } from '../../src/types';
import { getExpirationStatus } from '../../src/utils/expiration';

export default function InventoryScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'available' | 'need_to_buy'>('all');
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

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchInventory();
  };

  const handleDelete = (item: InventoryItem) => {
    Alert.alert(
      'Delete Item',
      `Are you sure you want to remove "${item.product_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('inventory_items').delete().eq('id', item.id);
            fetchInventory();
          },
        },
      ]
    );
  };

  const handleConsume = (item: InventoryItem) => {
    Alert.prompt(
      'Consume Item',
      'How many consumed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Consume',
          onPress: async (quantityStr) => {
            const qty = parseFloat(quantityStr || '1');
            const remaining = item.quantity - qty;
            
            if (remaining <= 0) {
              await supabase.from('inventory_items').update({ status: 'consumed' }).eq('id', item.id);
              await supabase.from('inventory_consumption').insert({
                user_id: profile?.id,
                inventory_item_id: item.id,
                quantity: qty,
                unit: item.unit,
              });
            } else {
              await supabase.from('inventory_items').update({ quantity: remaining }).eq('id', item.id);
              await supabase.from('inventory_consumption').insert({
                user_id: profile?.id,
                inventory_item_id: item.id,
                quantity: qty,
                unit: item.unit,
              });
            }
            fetchInventory();
          },
        },
      ]
    );
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.product_name.toLowerCase().includes(search.toLowerCase()) ||
      (item.brand || '').toLowerCase().includes(search.toLowerCase()) ||
      (item.category || '').toLowerCase().includes(search.toLowerCase());
    
    if (filter === 'available') return matchesSearch && item.status === 'available';
    if (filter === 'need_to_buy') return matchesSearch && (item.status === 'consumed' || item.status === 'wasted');
    return matchesSearch;
  });

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const expirationStatus = getExpirationStatus(item.expiration_date);
    
    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}
      >
        <View style={styles.itemImage}>
          <Text style={styles.itemImagePlaceholder}>
            {item.category === 'dairy' ? '🥛' : item.category === 'produce' ? '🥬' : item.category === 'meat' ? '🥩' : '📦'}
          </Text>
          {expirationStatus === 'expired' && (
            <View style={styles.statusBadgeExpired}>
              <Text style={styles.statusBadgeText}>Expired</Text>
            </View>
          )}
          {expirationStatus === 'today' && (
            <View style={styles.statusBadgeToday}>
              <Text style={styles.statusBadgeText}>Today</Text>
            </View>
          )}
          {expirationStatus === 'expiring_soon' && (
            <View style={styles.statusBadgeSoon}>
              <Text style={styles.statusBadgeText}>Expiring Soon</Text>
            </View>
          )}
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.product_name}</Text>
          <Text style={styles.itemDetails}>{item.quantity} {item.unit}</Text>
          <Text style={styles.itemExpiry}>
            {item.expiration_date ? `Expires ${new Date(item.expiration_date).toLocaleDateString()}` : 'No expiration date'}
          </Text>
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity onPress={() => handleConsume(item)}>
            <Text style={styles.consumeButton}>✓</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item)}>
            <Text style={styles.deleteButton}>✕</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <Text>Loading inventory...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Inventory</Text>
        <TouchableOpacity onPress={() => router.push('/inventory/add')}>
          <Text style={styles.addButton}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search food or category"
        />
      </View>

      <View style={styles.filterTabs}>
        {(['all', 'available', 'need_to_buy'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f === 'need_to_buy' ? 'Need to Buy' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>Your inventory is empty</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/inventory/add')}>
              <Text style={styles.emptyButtonText}>Add your first item</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  addButton: { fontSize: 16, color: COLORS.primary, fontWeight: '600' },
  searchBar: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  searchInput: { backgroundColor: COLORS.white, borderRadius: 10, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.divider },
  filterTabs: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  filterTab: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.white },
  filterTabActive: { backgroundColor: COLORS.primaryLight },
  filterTabText: { fontSize: 13, color: COLORS.secondaryText },
  filterTabTextActive: { color: COLORS.primary, fontWeight: '600' },
  itemCard: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  itemImage: { width: 50, height: 50, borderRadius: 8, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  itemImagePlaceholder: { fontSize: 24 },
  statusBadgeExpired: { position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.danger, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 8 },
  statusBadgeToday: { position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.warning, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 8 },
  statusBadgeSoon: { position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.primary, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 8 },
  statusBadgeText: { color: COLORS.white, fontSize: 9, fontWeight: '600' },
  itemInfo: { flex: 1, marginLeft: SPACING.md, justifyContent: 'center' },
  itemName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  itemDetails: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  itemExpiry: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  itemActions: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  consumeButton: { fontSize: 18, color: COLORS.success, padding: SPACING.xs },
  deleteButton: { fontSize: 18, color: COLORS.danger, padding: SPACING.xs },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: 16, color: COLORS.secondaryText, marginBottom: SPACING.md },
  emptyButton: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: 8 },
  emptyButtonText: { color: COLORS.white, fontWeight: '600' },
});