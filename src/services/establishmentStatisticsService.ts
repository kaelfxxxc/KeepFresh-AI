import { supabase } from '../lib/supabase';

export type StatisticsPeriod = '1day' | '7days' | '30days' | 'custom';
export interface SalesOrder {
  id: string;
  created_at: string;
  destination: string;
  status: string;
  subtotal: number;
  total: number;
  items: { product_name: string; quantity: number; unit: string; unit_price: number; line_total: number }[];
}

export const establishmentStatisticsService = {
  async list(userId: string, start: Date, end: Date): Promise<SalesOrder[]> {
    const { data, error } = await supabase
      .from('inventory_orders')
      .select('id,created_at,destination,status,subtotal,total,inventory_order_items(product_name,quantity,unit,unit_price,line_total)')
      .eq('user_id', userId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      destination: row.destination,
      status: row.status,
      subtotal: Number(row.subtotal || 0),
      total: Number(row.total || 0),
      items: (row.inventory_order_items ?? []).map((item: any) => ({
        product_name: item.product_name, quantity: Number(item.quantity || 0), unit: item.unit,
        unit_price: Number(item.unit_price || 0), line_total: Number(item.line_total || 0),
      })),
    }));
  },
};
