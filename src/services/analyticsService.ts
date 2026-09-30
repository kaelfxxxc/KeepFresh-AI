import { supabase } from '../lib/supabase';
import { calculateFoodWaste, calculateFoodConsumption } from '../utils/calculations';

type AnalyticsPeriod = 'week' | 'month' | 'year';

function periodStart(period: AnalyticsPeriod, now: Date): Date {
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

async function getPeriodAnalytics(userId: string, period: AnalyticsPeriod) {
  const now = new Date();
  const startDate = periodStart(period, now).toISOString();
  const endDate = now.toISOString();
  const [waste, consumption] = await Promise.all([
    calculateFoodWaste(userId, startDate, endDate),
    calculateFoodConsumption(userId, startDate, endDate),
  ]);

  return { waste, consumption, savings: Math.round(consumption) };
}

export const analyticsService = {
  getWeeklyAnalytics: (userId: string) => getPeriodAnalytics(userId, 'week'),
  getMonthlyAnalytics: (userId: string) => getPeriodAnalytics(userId, 'month'),
  getYearlyAnalytics: (userId: string) => getPeriodAnalytics(userId, 'year'),

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
