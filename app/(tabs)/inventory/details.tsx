import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl, Modal, TextInput } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { InventoryItem, Consumption } from '../../types';
import { getExpirationStatus } from '../../utils/expiration';
import { COLORS, SPACING } from '../../theme';

export default function InventoryDetailsScreen({ route }: { route: any }) {
  const { profile } = useAuth();
  const itemId = route.params?.id;
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [consumedQuantity, setConsumedQuantity] = useState(0);

  useEffect(() => {
    if (!itemId || !profile) return;
    
    supabase
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .single()
      .then(({ data }) => setItem(data))
      .then(() => setLoading(false));
  }, [itemId, profile]);

  const handleConsume = async () => {
    if (!item) return;
    
    Alert.prompt(
      'Consume Item',
      'How many consumed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Consume',
          onPress: async (quantityStr) => {
            const qty = parseFloat(quantityStr || '1');
            if (qty > item.quantity) {
              Alert.alert('Error', 'Consumed quantity cannot exceed available quantity');
              return;
            }
            
            const remaining = item.quantity - qty;
            
            await supabase.from('inventory_items')
              .update({ 
                quantity: remaining > 0 ? remaining : 0,
                status: remaining <= 0 ? 'consumed' : 'available',
              })
              .eq('id', item.id);
            
            await supabase.from('inventory_consumption').insert({
              user_id: profile?.id,
              inventory_item_id: item.id,
              quantity: qty,
              unit: item.unit,
            });
            
            setLoading(false);
          },
        },
      ]
    );
  };

  const handleWaste = async () => {
    if (!item) return;
    
    Alert.alert(
      'Mark as Waste',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as Waste',
          onPress: async () => {
            await supabase.from('food_waste').insert({
              user_id: profile?.id,
              inventory_item_id: item.id,
              quantity: item.quantity,
              unit: item.unit,
              reason: 'User marked as waste',
              estimated_value: item.price * item.quantity || 0,
            });
            
            await supabase.from('inventory_items')
              .update({ status: 'wasted' })
              .eq('id', item.id);
            
            setLoading(false);
          },
        },
      ]
    );
  };

  const handleDelete = async () => {
    Alert.alert(
      'Delete Item',
      `Are you sure you want to remove "${item?.product_name || 'this item'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('inventory_items').delete().eq('id', item.id);
            setLoading(false);
            router.back();
          },
        },
      ]
    );
  };

  if (loading || !item) {
    return (
      <View style={styles.loading}>
        <Text>Loading item details...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{item.product_name}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.imageSection}>
        <Text style={styles.imagePlaceholder}>
          {item.category === 'dairy' ? '🥛' : item.category === 'produce' ? '🥬' : item.category === 'meat' ? '🥩' : '📦'}
        </Text>
      </View>

      <View style={styles.detailsSection}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Brand</Text>
          <Text style={styles.detailValue}>{item.brand || 'N/A'}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Category</Text>
          <Text style={styles.detailValue}>{item.category || 'N/A'}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Quantity</Text>
          <Text style={styles.detailValue}>{item.quantity} {item.unit}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Purchase Date</Text>
          <Text style={styles.detailValue}>{item.purchase_date ? new Date(item.purchase_date).toLocaleDateString() : 'N/A'}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Expiration Date</Text>
          <Text style={styles.detailValue}>
            {item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : 'No date'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Barcode</Text>
          <Text style={styles.detailValue}>{item.barcode || 'N/A'}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Notes</Text>
          <Text style={styles.detailValue}>{item.notes || 'No notes'}</Text>
        </View>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={handleConsume}>
          <Text style={styles.actionButtonText}>
            {item.quantity > 0 ? 'Mark as Consumed' : 'Consumed'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: COLORS.danger }]} onPress={handleWaste}>
          <Text style={styles.actionButtonText}>Mark as Waste</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          <Text style={styles.actionButtonText}>Delete Item</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  title: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  closeButton: { padding: SPACING.sm, color: COLORS.secondaryText },
  closeText: { fontSize: 24 },
  imageSection: { padding: SPACING.lg, alignItems: 'center' },
  imagePlaceholder: { fontSize: 48 },
  detailsSection: { paddingHorizontal: SPACING.lg },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.md, borderBottomColor: COLORS.divider, borderBottomWidth: 1 },
  detailLabel: { fontSize: 13, color: COLORS.secondaryText },
  detailValue: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  actionButtons: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.lg },
  actionButton: { flex: 1, paddingVertical: SPACING.md, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider },
  actionButtonText: { color: COLORS.primary, fontWeight: '600' },
});