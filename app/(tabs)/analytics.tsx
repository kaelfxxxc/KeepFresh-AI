import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING } from '../../theme';
import { calculateFoodWaste, calculateFoodConsumption, calculateEstimatedSavings } from '../../utils/calculations';
import { AnalyticsCard } from '../../components/AnalyticsCard';

export default function AnalyticsScreen() {
  const { profile } = useAuth();
  const [analytics, setAnalytics] = useState({
    foodUsed: 0,
    totalItems: 0,
    itemsUsed: 0,
    itemsWasted: 0,
    wasteBreakdown: {},
    estimatedSavings: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = async () => {
    if (!profile) return;
    try {
      setLoading(true);
      
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      
      const [waste, consumption] = await Promise.all([
        calculateFoodWaste(profile.id, startOfMonth.toISOString(), today.toISOString()),
        calculateFoodConsumption(profile.id, startOfMonth.toISOString(), today.toISOString()),
      ]);

      const { data: items } = await supabase
        .from('inventory_items')
        .select('status')
        .eq('user_id', profile.id);
      
      const totalItems = items?.length || 0;
      const itemsUsed = items?.filter(i => i.status === 'consumed').length || 0;
      const itemsWasted = items?.filter(i => i.status === 'wasted').length || 0;
      const foodUsed = totalItems > 0 ? Math.round((itemsUsed / totalItems) * 100) : 0;

      const savings = await calculateEstimatedSavings(profile.id, startOfMonth.toISOString(), today.toISOString());

      const { data: wasteBreakdown } = await supabase
        .from('food_waste')
        .select('estimated_value, inventory_item_id')
        .eq('user_id', profile.id)
        .gte('wasted_at', startOfMonth.toISOString());
      
      const breakdown: Record<string, number> = {};
      if (wasteBreakdown) {
        wasteBreakdown.forEach(w => {
          breakdown['Vegetables'] = (breakdown['Vegetables'] || 0) + (w.estimated_value || 0);
        });
      }

      setAnalytics({
        foodUsed,
        totalItems,
        itemsUsed,
        itemsWasted,
        wasteBreakdown: breakdown,
        estimatedSavings: savings,
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAnalytics();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Food Inventory & Waste</Text>
      
      <View style={styles.timeFilters}>
        {['week', 'month', 'year'].map(period => (
          <TouchableOpacity key={period} style={styles.timeFilter}>
            <Text style={styles.timeFilterText}>{period.charAt(0).toUpperCase() + period.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <Text>Loading analytics...</Text>
        </View>
      ) : (
        <FlatList
          data={[
            { label: 'Food Used', value: `${analytics.foodUsed}%`, subtitle: 'of total inventory', icon: '📊' },
            { label: 'Total Items', value: `${analytics.totalItems}`, subtitle: 'in inventory', icon: '📦' },
            { label: 'Items Used', value: `${analytics.itemsUsed}`, subtitle: 'consumed this month', icon: '✓' },
            { label: 'Items Wasted', value: `${analytics.itemsWasted}`, subtitle: 'wasted this month', icon: '🗑️' },
            { label: 'Estimated Savings', value: `₱${analytics.estimatedSavings}`, subtitle: 'from reducing waste', icon: '💰' },
          ]}
          keyExtractor={(_, i) => i.toString()}
          renderItem={({ item }) => <AnalyticsCard data={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, padding: SPACING.lg },
  timeFilters: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  timeFilter: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.white },
  timeFilterText: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: SPACING.lg, paddingBottom: SPACING.xl },
});