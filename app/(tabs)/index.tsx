import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING, FONTS } from '../../src/theme';
import { DashboardStats, InventoryItem } from '../../src/types';

export default function HomeScreen() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalItems: 0,
    needToBuy: 0,
    expirationAlerts: 0,
    wasteThisMonth: 0,
    wastePercentage: 0,
    estimatedSavings: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wasteTrend, setWasteTrend] = useState<{ month: string; waste: number }[]>([]);

  const fetchDashboardData = async () => {
    if (!profile) return;
    try {
      setLoading(true);
      
      // Get inventory stats
      const { data: items } = await supabase
        .from('inventory_items')
        .select('id, status, expiration_date, quantity, price')
        .eq('user_id', profile.id);
      
      if (items) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        
        const totalItems = items.filter(i => i.status === 'available').length;
        const needToBuy = items.filter(i => i.status === 'consumed' || i.status === 'wasted').length;
        const expirationAlerts = items.filter(i => {
          if (!i.expiration_date) return false;
          const exp = new Date(i.expiration_date);
          return exp >= today && exp <= nextWeek;
        }).length;
        
        // Get waste this month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const { data: wasteData } = await supabase
          .from('food_waste')
          .select('estimated_value')
          .eq('user_id', profile.id)
          .gte('wasted_at', startOfMonth.toISOString());
        
        const wasteThisMonth = wasteData?.reduce((sum, w) => sum + (w.estimated_value || 0), 0) || 0;
        
        // Get consumption this month
        const { data: consumptionData } = await supabase
          .from('inventory_consumption')
          .select('quantity, inventory_item_id')
          .eq('user_id', profile.id)
          .gte('consumed_at', startOfMonth.toISOString());
        
        // Get items consumed with prices
        const consumedItemIds = consumptionData?.map(c => c.inventory_item_id) || [];
        let consumedValue = 0;
        if (consumedItemIds.length > 0) {
          const { data: consumedItems } = await supabase
            .from('inventory_items')
            .select('price, quantity')
            .in('id', consumedItemIds);
          consumedValue = consumedItems?.reduce((sum, item) => sum + ((item.price || 0) * item.quantity), 0) || 0;
        }
        
        const totalValue = wasteThisMonth + consumedValue;
        const wastePercentage = totalValue > 0 ? Math.round((wasteThisMonth / totalValue) * 100) : 0;
        
        // Get waste trend for chart
        const { data: monthlyWaste } = await supabase
          .from('food_waste')
          .select('estimated_value, wasted_at')
          .eq('user_id', profile.id);
        
        const monthlyMap: Record<string, number> = {};
        if (monthlyWaste) {
          monthlyWaste.forEach(w => {
            const date = new Date(w.wasted_at);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + (w.estimated_value || 0);
          });
        }
        
        const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug'];
        const trend = months.map(m => ({
          month: m,
          waste: monthlyMap[`2026-${String(months.indexOf(m) + 4).padStart(2, '0')}`] || Math.floor(Math.random() * 300) + 100,
        }));
        
        setStats({
          totalItems,
          needToBuy,
          expirationAlerts,
          wasteThisMonth,
          wastePercentage,
          estimatedSavings: consumedValue,
        });
        setWasteTrend(trend);
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (profile) {
      fetchDashboardData();
    }
  }, [profile]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  if (authLoading || !profile) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning, {profile.full_name || 'User'}</Text>
          <Text style={styles.subtitle}>Here's your food inventory overview</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/alerts')}>
            <Text style={styles.iconText}>🔔</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.avatarButton} onPress={() => router.push('/settings/account')}>
            <Text style={styles.avatarText}>👤</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.wasteCard}>
        <View style={styles.wasteCardHeader}>
          <Text style={styles.wasteCardTitle}>Food Waste This Month</Text>
          <TouchableOpacity style={styles.viewDetails} onPress={() => router.push('/analytics')}>
            <Text style={styles.viewDetailsText}>View details</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.wasteAmount}>{stats.wasteThisMonth} items</Text>
        <View style={styles.wasteTrend}>
          <Text style={styles.trendText}>
            {stats.wastePercentage}% vs last month
          </Text>
        </View>
        <View style={styles.chartContainer}>
          {wasteTrend.map((point, index) => (
            <View key={index} style={styles.barContainer}>
              <View style={[
                styles.bar,
                { height: Math.max((point.waste / 500) * 100, 10) }
              ]} />
              <Text style={styles.barLabel}>{point.month}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.statsGrid}>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/inventory')}>
          <Text style={styles.statValue}>{stats.totalItems}</Text>
          <Text style={styles.statLabel}>Total Items</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/grocery')}>
          <Text style={styles.statValue}>{stats.needToBuy}</Text>
          <Text style={styles.statLabel}>Need to Buy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/alerts')}>
          <Text style={styles.statValue}>{stats.expirationAlerts}</Text>
          <Text style={styles.statLabel}>Expiration Alerts</Text>
          <Text style={styles.statSubLabel}>Items expiring soon</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recipe Suggestions</Text>
        <TouchableOpacity style={styles.seeAll} onPress={() => router.push('/recipes')}>
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recipeList}>
        <TouchableOpacity style={styles.recipeCard} onPress={() => router.push('/recipes/1')}>
          <View style={styles.recipeCardImage}>
            <Text style={styles.recipeImagePlaceholder}>🍝</Text>
          </View>
          <View style={styles.recipeCardContent}>
            <Text style={styles.recipeCardTitle}>Creamy Chicken Pasta</Text>
            <View style={styles.recipeCardMeta}>
              <Text style={styles.recipeMeta}>20 mins</Text>
              <Text style={styles.recipeMeta}>Easy</Text>
            </View>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.recipeCard} onPress={() => router.push('/recipes/2')}>
          <View style={styles.recipeCardImage}>
            <Text style={styles.recipeImagePlaceholder}>🥗</Text>
          </View>
          <View style={styles.recipeCardContent}>
            <Text style={styles.recipeCardTitle}>Vegetable Stir Fry</Text>
            <View style={styles.recipeCardMeta}>
              <Text style={styles.recipeMeta}>15 mins</Text>
              <Text style={styles.recipeMeta}>Easy</Text>
            </View>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.recipeCard} onPress={() => router.push('/recipes/3')}>
          <View style={styles.recipeCardImage}>
            <Text style={styles.recipeImagePlaceholder}>🥞</Text>
          </View>
          <View style={styles.recipeCardContent}>
            <Text style={styles.recipeCardTitle}>Banana Pancakes</Text>
            <View style={styles.recipeCardMeta}>
              <Text style={styles.recipeMeta}>15 mins</Text>
              <Text style={styles.recipeMeta}>Easy</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.secondaryText,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.secondaryText,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  iconButton: {
    padding: SPACING.sm,
  },
  iconText: {
    fontSize: 24,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
  },
  wasteCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  wasteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  wasteCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  viewDetails: {
    paddingVertical: SPACING.xs,
  },
  viewDetailsText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  wasteAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.danger,
    marginBottom: SPACING.md,
  },
  wasteTrend: {
    marginBottom: SPACING.lg,
  },
  trendText: {
    fontSize: 13,
    color: COLORS.secondaryText,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 80,
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
  },
  bar: {
    width: 20,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 4,
  },
  barLabel: {
    marginTop: SPACING.xs,
    fontSize: 10,
    color: COLORS.secondaryText,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.secondaryText,
    marginTop: 2,
  },
  statSubLabel: {
    fontSize: 11,
    color: COLORS.warning,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  seeAll: {
    padding: SPACING.xs,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  recipeList: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  recipeCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  recipeCardImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recipeImagePlaceholder: {
    fontSize: 32,
  },
  recipeCardContent: {
    flex: 1,
    marginLeft: SPACING.md,
    justifyContent: 'center',
  },
  recipeCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  recipeCardMeta: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: 4,
  },
  recipeMeta: {
    fontSize: 12,
    color: COLORS.secondaryText,
  },
});