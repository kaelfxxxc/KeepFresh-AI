import { supabase } from '../lib/supabase';
import { InventoryItem } from '../types';

export const inventoryService = {
  async getInventory(userId: string): Promise<InventoryItem[]> {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getInventoryItem(id: string): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async createInventoryItem(item: Partial<InventoryItem>): Promise<InventoryItem> {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert(item)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateInventoryItem(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem> {
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteInventoryItem(id: string): Promise<void> {
    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async consumeInventoryItem(userId: string, itemId: string, quantity: number): Promise<void> {
    const { error } = await supabase.rpc('consume_inventory_item', {
      p_user_id: userId,
      p_item_id: itemId,
      p_quantity: quantity,
    });
    if (error) throw error;
  },

  async searchInventory(userId: string, query: string): Promise<InventoryItem[]> {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .or(`product_name.ilike.%${query}%,brand.ilike.%${query}%,category.ilike.%${query}%`);
    if (error) throw error;
    return data || [];
  },

  async getExpiringItems(userId: string, days: number): Promise<InventoryItem[]> {
    const { data, error } = await supabase.rpc('get_expiring_items', {
      user_id: userId,
      days,
    });
    if (error) throw error;
    return data || [];
  },
};