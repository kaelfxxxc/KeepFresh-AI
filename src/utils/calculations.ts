import { supabase } from '../lib/supabase';
import type { Profile, InventoryItem, Consumption, FoodWaste, AnalyticsData } from '../types';

export async function getExpiringItems(userId: string, days: number): Promise<InventoryItem[]> {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('user_id', userId)
    .gte('expiration_date', startDate.toISOString())
    .lte('expiration_date', endDate.toISOString())
    .neq('status', 'consumed');
  
  return data || [];
}

export async function calculateFoodWaste(userId: string, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase
    .from('food_waste')
    .select('estimated_value')
    .eq('user_id', userId)
    .gte('wasted_at', startDate)
    .lte('wasted_at', endDate);
  
  return data?.reduce((sum, w) => sum + (w.estimated_value || 0), 0) || 0;
}

export async function calculateFoodConsumption(userId: string, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase
    .from('inventory_consumption')
    .select('quantity, inventory_item_id')
    .eq('user_id', userId)
    .gte('consumed_at', startDate)
    .lte('consumed_at', endDate);
  
  if (!data) return 0;
  
  let total = 0;
  for (const item of data) {
    const { data: itemData } = await supabase
      .from('inventory_items')
      .select('price, quantity')
      .eq('id', item.inventory_item_id)
      .single();
    if (itemData?.price) {
      total += itemData.price * item.quantity;
    }
  }
  
  return total;
}

export async function calculateEstimatedSavings(userId: string, startDate: string, endDate: string): Promise<number> {
  const consumption = await calculateFoodConsumption(userId, startDate, endDate);
  return Math.round(consumption);
}

export async function getRecipeMatches(userId: string, category?: string, limit: number = 10): Promise<any[]> {
  const { data } = await supabase
    .from('recipes')
    .select('*')
    .eq('category', category || 'meals')
    .limit(limit);
  
  return data || [];
}