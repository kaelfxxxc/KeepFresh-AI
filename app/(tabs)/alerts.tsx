import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Modal } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING, FONTS } from '../../theme';
import { InventoryItem } from '../../types';
import { getExpirationStatus } from '../../utils/expiration';

export default function AlertsScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alertDays, setAlertDays] = useState<number>(3);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlerts = async () => {
    if (!profile) return;
    try {
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', profile.id)
        .neq('status', 'consumed')
        .neq('status', 'wasted');
      
      if (data) setItems(data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAlerts();
  };

  const filteredItems = items.filter(item => {
    if (!item.expiration_date) return false;
    const date = new Date(item.expiration_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffDays = (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    
    if (alertDays === 1) return diffDays === 0;
    if (alertDays === 7) return diffDays >= 0 && diffDays <= 7;
    if (alertDays === 30) return diffDays >= 0 && diffDays <= 30;
    
    return false;
  });

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const status = getExpirationStatus(item.expiration_date);
    
    return (
      <View style={styles.alertCard}>
        <View style={styles.alertHeader}>
          <Text style={styles.alertTitle}>{item.product_name}</Text>
          <Text style={styles.alertDate}>
            {new Date(item.expiration_date).toLocaleDateString()}
          </Text>
        </View>
        <Text style={styles.alertQuantity}>
          {item.quantity} {item.unit}
        </Text>
        <View style={styles.alertStatusContainer}>
          <Text style={[styles.alertStatusText, styles[`alertStatus${status}`]]}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Text>
        </View>
        <TouchableOpacity style={styles.useNowButton} onPress={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })}>
          <Text style={styles.useNowText}>Use Now</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <Text>Loading alerts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Expiration Alerts</Text>
        <TouchableOpacity onPress={() => setAlertDays(1)}>
          <Text style={styles.filterTab}>Today</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAlertDays(7)}>
          <Text style={styles.filterTab}>7 Days</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAlertDays(30)}>
          <Text style={styles.filterTab}>30 Days</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        <TouchableOpacity style={[styles.filterOption, alertDays === 1 && styles.filterOptionActive]} onPress={() => setAlertDays(1)}>
          <Text style={[styles.filterText, alertDays === 1 && styles.filterTextActive]}>Expiring Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterOption, alertDays === 7 && styles.filterOptionActive]} onPress={() => setAlertDays(7)}>
          <Text style={[styles.filterText, alertDays === 7 && styles.filterTextActive]}>Next 7 Days</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterOption, alertDays === 30 && styles.filterOptionActive]} onPress={() => setAlertDays(30)}>
          <Text style={[styles.filterText, alertDays === 30 && styles.filterTextActive]}>This Month</Text>
        </TouchableOpacity>
      </View>

      {filteredItems.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyText}>You're all caught up!</Text>
        </View>
      )}

      <FlatList
        data={filteredItems}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyText}>You're all caught up!</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  filterTab: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: 20, backgroundColor: COLORS.white, marginRight: 8 },
  filterTabActive: { backgroundColor: COLORS.primaryLight, marginRight: 0 },
  filterText: { fontSize: 13, color: COLORS.secondaryText },
  filterTextActive: { color: COLORS.primary, fontWeight: '600' },
  filterBar: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  filterOption: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: 20, backgroundColor: COLORS.white, marginRight: 8 },
  alertCard: { backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  alertHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs },
  alertTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  alertDate: { fontSize: 12, color: COLORS.secondaryText },
  alertQuantity: { fontSize: 13, color: COLORS.secondaryText, marginBottom: SPACING.xs },
  alertStatusContainer: { flexDirection: 'row', gap: 6, marginTop: SPACING.xs },
  alertStatusText: { fontSize: 10, fontWeight: '600' },
  alertStatusDanger: { color: COLORS.danger },
  alertStatusExpiringSoon: { color: COLORS.warning },
  alertStatusToday: { color: COLORS.primary },
  alertStatusSafe: { color: COLORS.success },
  useNowButton: { marginTop: SPACING.xs, padding: SPACING.md, backgroundColor: COLORS.primaryLight, borderRadius: 8 },
  useNowText: { color: COLORS.primary, fontWeight: '600', textAlign: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: 16, color: COLORS.secondaryText },
});