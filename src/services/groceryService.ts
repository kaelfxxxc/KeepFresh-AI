import { supabase } from '../lib/supabase';
import { GroceryList, GroceryItem } from '../types';

export const groceryService = {
  async getGroceryList(userId: string): Promise<{ list: GroceryList | null; items: GroceryItem[] }> {
    const { data: lists, error: listError } = await supabase
      .from('grocery_lists')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (listError) return { list: null, items: [] };

    const { data: items, error: itemsError } = await supabase
      .from('grocery_items')
      .select('*')
      .eq('grocery_list_id', lists.id);

    if (itemsError) return { list: lists, items: [] };

    return { list: items.length > 0 ? { ...lists, name: `${lists.name} (${items.length} items)` } : lists, items };
  },

  async getGroceryLists(userId: string): Promise<GroceryList[]> {
    const { data, error } = await supabase
      .from('grocery_lists')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async addGroceryItem(listId: string, item: Partial<GroceryItem>): Promise<GroceryItem> {
    const { data, error } = await supabase
      .from('grocery_items')
      .insert({ ...item, grocery_list_id: listId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateGroceryItem(itemId: string, updates: Partial<GroceryItem>): Promise<GroceryItem> {
    const { data, error } = await supabase
      .from('grocery_items')
      .update(updates)
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteGroceryItem(itemId: string): Promise<void> {
    const { error } = await supabase
      .from('grocery_items')
      .delete()
      .eq('id', itemId);
    if (error) throw error;
  },

  async togglePurchased(itemId: string): Promise<GroceryItem> {
    const { data, error } = await supabase
      .from('grocery_items')
      .update({ purchased: true })
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async calculateBudget(listId: string): Promise<number> {
    const { data, error } = await supabase
      .from('grocery_items')
      .select('estimated_price')
      .eq('grocery_list_id', listId)
      .not('estimated_price', 'is', null);
    if (error) throw error;
    return data?.reduce((sum, item) => sum + (item.estimated_price || 0), 0) || 0;
  },
};