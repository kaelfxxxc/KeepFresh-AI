import { supabase } from '../lib/supabase';
import { calculateFoodWaste, calculateFoodConsumption, calculateEstimatedSavings } from '../utils/calculations';

export const analyticsService = {
  async getWeeklyAnalytics(userId: string) {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const waste = await calculateFoodWaste(userId, startOfWeek.toISOString(), today.toISOString());
    const consumption = await calculateFoodConsumption(userId, startOfWeek.toISOString(), today.toISOString());
    const savings = await calculateEstimatedSavings(userId, startOfWeek.toISOString(), today.toISOString());
    
    return { waste, consumption, savings };
  },

  async getMonthlyAnalytics(userId: string) {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const waste = await calculateFoodWaste(userId, startOfMonth.toISOString(), today.toISOString());
    const consumption = await calculateFoodConsumption(userId, startOfMonth.toISOString(), today.toISOString());
    const savings = await calculateEstimatedSavings(userId, startOfMonth.toISOString(), today.toISOString());
    
    return { waste, consumption, savings };
  },

  async getYearlyAnalytics(userId: string) {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    
    const waste = await calculateFoodWaste(userId, startOfYear.toISOString(), today.toISOString());
    const consumption = await calculateFoodConsumption(userId, startOfYear.toISOString(), today.toISOString());
    const savings = await calculateEstimatedSavings(userId, startOfYear.toISOString(), today.toISOString());
    
    return { waste, consumption, savings };
  },

  async getWasteBreakdown(userId: string, startDate: string, endDate: string) {
    const { data, error } = await supabase
      .from('food_waste')
      .select('estimated_value, inventory_item_id')
      .eq('user_id', userId)
      .gte('wasted_at', startDate)
      .lte('wasted_at', endDate);
    if (error) throw error;
    
    const breakdown: Record<string, number> = {};
    if (data) {
      data.forEach(item => {
        breakdown['Vegetables'] = (breakdown['Vegetables'] || 0) + (item.estimated_value || 0);
      });
    }
    
    return breakdown;
  },
};