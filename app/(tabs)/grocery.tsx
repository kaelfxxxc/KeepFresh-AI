import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Modal, Alert, TextInput } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, FONTS } from '../../theme';
import { GroceryList, GroceryItem } from '../../types';
import { calculateBudget } from '../../utils/calculations';

export default function GroceryListScreen() {
  const { profile } = useAuth();
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [currentList, setCurrentList] = useState<GroceryList | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLists = useCallback(async () => {
    if (!profile) return;
    try {
      const { data } = await supabase
        .from('grocery_lists')
        .select('*')
        .eq('user_id', profile.id)
        .order('updated_at', { ascending: false });
      if (data) setLists(data);
    } catch (error) {
      console.error('Error fetching grocery lists:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const createList = async () => {
    const { data: list, error } = await supabase
      .from('grocery_lists')
      .insert({ name: 'New List', user_id: profile?.id })
      .select()
      .single();
    if (error) return Alert.alert('Error', error.message);
    setCurrentList(list);
    setItems([]);
  };

  const fetchItems = useCallback(async (listId?: string) => {
    if (!profile) return;
    try {
      const id = listId || currentList?.id;
      if (!id) return;
      const { data } = await supabase
        .from('grocery_items')
        .select('*')
        .eq('grocery_list_id', id)
        .order('created_at', { ascending: true });
      if (data) {
        setItems(data);
        await calculateBudget(listId || currentList?.id);
      }
    } catch (error) {
      console.error('Error fetching grocery items:', error);
    }
  }, [currentList?.id]);

  useEffect(() => {
    if (currentList) fetchItems(currentList.id);
  }, [currentList?.id]);

  const addItem = async () => {
    Alert.alert(
      'Add Item',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: async () => {
            const input = document.createElement('input');
            document.body.appendChild(input);
            input.focus();
            input.addEventListener('keypress', async (e: any) => {
              if (e.key === 'Enter') {
                const name = input.value;
                const { error } = await supabase
                  .from('grocery_items')
                  .insert({ name, grocery_list_id: currentList?.id, purchased: false });
                if (!error) fetchItems(currentList?.id);
                document.body.removeChild(input);
              }
            });
          },
        },
      ]
    );
  };

  const togglePurchased = async (item: GroceryItem) => {
    await supabase
      .from('grocery_items')
      .update({ purchased: !item.purchased })
      .eq('id', item.id);
    fetchItems(currentList?.id);
  };

  const deleteItem = async (item: GroceryItem) => {
    await supabase.from('grocery_items').delete().eq('id', item.id);
    fetchItems(currentList?.id);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Grocery List</Text>
        <TouchableOpacity style={styles.addButton} onPress={createList}>
          <Text style={styles.addButtonText}>+ New List</Text>
        </TouchableOpacity>
      </View>

      {currentList ? (
        <>
          <View style={styles.listDetails}>
            <Text style={styles.listName}>{currentList.name}</Text>
            <TouchableOpacity style={styles.clearButton} onPress={() => {
              Alert.alert(
                'Clear List',
                'Are you sure you want to clear all items?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: async () => {
                    await supabase.from('grocery_items').delete().eq('grocery_list_id', currentList.id);
                    fetchItems();
                  } },
                ]
              );
            }}>
              <Text style={styles.clearButtonText}>Clear all</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search items"
            />
          </View>

          <FlatList
            data={items}
            keyExtractor={item => item.id}
            renderItem={({ item }: { item: GroceryItem }) => (
              <TouchableOpacity style={styles.itemRow}>
                <Text style={styles.itemCheckbox}>{item.purchased ? '✓' : ''}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQuantity}>{item.quantity} {item.unit || ''}</Text>
                <Text style={styles.itemPrice}>₱{(item.estimated_price || 0).toFixed(2)}</Text>
                <TouchableOpacity style={styles.itemToggle} onPress={() => togglePurchased(item)}>
                  <Text style={styles.itemToggleText}>{item.purchased ? 'Purchased' : 'Add'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.itemDelete} onPress={() => deleteItem(item)}>
                  <Text style={styles.itemDeleteText}>Delete</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No items in this list</Text>
              </View>
            }
          />
        </>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🛒</Text>
          <Text style={styles.emptyText}>Your grocery list is empty</Text>
          <TouchableOpacity onPress={createList}>
            <Text style={styles.emptyButton}>Create your first list</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.estimatedBudget}>
        <Text style={styles.budgetLabel}>Estimated Budget</Text>
        <Text style={styles.budgetAmount}>₱0.00</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  addButton: { padding: SPACING.md, backgroundColor: COLORS.primary, borderRadius: 8 },
  addButtonText: { color: COLORS.white, fontWeight: '600' },
  listDetails: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  listName: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  clearButton: { marginTop: SPACING.xs },
  clearButtonText: { color: COLORS.danger, fontSize: 12 },
  searchContainer: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  searchInput: { backgroundColor: COLORS.white, borderRadius: 10, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.divider, width: '80%' },
  estimatedBudget: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, borderTopColor: COLORS.divider, borderTopWidth: 1 },
  budgetLabel: { fontSize: 14, color: COLORS.secondaryText },
  budgetAmount: { fontSize: 24, fontWeight: 'bold', color: COLORS.primary },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: 16, color: COLORS.secondaryText, textAlign: 'center' },
  emptyButton: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: 8, marginTop: SPACING.md },
  emptyButtonText: { color: COLORS.white, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, padding: SPACING.md, borderRadius: 8, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  itemCheckbox: { fontSize: 16, color: COLORS.secondaryText, marginRight: SPACING.md, minWidth: 20 },
  itemName: { flex: 1, fontSize: 14, color: COLORS.text, marginRight: SPACING.md },
  itemQuantity: { fontSize: 12, color: COLORS.secondaryText, marginRight: SPACING.md },
  itemPrice: { fontSize: 14, color: COLORS.secondaryText },
  itemToggle: { marginLeft: SPACING.md },
  itemToggleText: { fontSize: 12, color: COLORS.primary },
  itemDelete: { marginLeft: SPACING.md },
  itemDeleteText: { fontSize: 12, color: COLORS.danger },
});