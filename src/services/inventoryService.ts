import { supabase } from '../lib/supabase';
import { InventoryItem, InventoryTransaction } from '../types';

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

  /**
   * Inventory narrowed to one storage area.
   *
   * `'unassigned'` is a real bucket rather than a special case in the UI: items
   * predating storage areas, or orphaned when an area was deleted, live there
   * and must stay reachable.
   */
  async getInventoryByArea(
    userId: string,
    area: string | 'all' | 'unassigned'
  ): Promise<InventoryItem[]> {
    let query = supabase.from('inventory_items').select('*').eq('user_id', userId);

    if (area === 'unassigned') query = query.is('storage_area_id', null);
    else if (area !== 'all') query = query.eq('storage_area_id', area);

    const { data, error } = await query.order('updated_at', { ascending: false });
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
      .insert({
        ...item,
        // Attribution for shared/establishment inventories. The owner is the
        // only sensible default when no one else is signed in.
        added_by: item.added_by ?? item.user_id ?? null,
      })
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

  /**
   * The ± control. Uses the RPC rather than a read-modify-write so two devices
   * tapping at once cannot clobber each other, and so the quantity can never be
   * driven below zero — the database clamps with GREATEST(…, 0) under a row
   * lock, and the CHECK constraint backs it up.
   *
   * Returns the updated row so the caller can reconcile without a refetch.
   */
  async adjustQuantity(itemId: string, delta: number): Promise<InventoryItem> {
    if (delta === 0) {
      const existing = await this.getInventoryItem(itemId);
      if (!existing) throw new Error('That item no longer exists.');
      return existing;
    }
    const { data, error } = await supabase.rpc('adjust_inventory_quantity', {
      p_item_id: itemId,
      p_delta: delta,
    });
    if (error) throw error;
    return data as InventoryItem;
  },

  /** Set an exact quantity (typed entry). Routed through the same RPC so the
   *  floor-at-zero and locking behaviour are identical. */
  async setQuantity(itemId: string, quantity: number, currentQuantity: number): Promise<InventoryItem> {
    const target = Math.max(quantity, 0);
    return this.adjustQuantity(itemId, target - currentQuantity);
  },

  /** Edit the expiry date and/or how many days ahead to warn. */
  async setExpiration(
    itemId: string,
    expirationDate: string | null,
    alertDays?: number
  ): Promise<InventoryItem> {
    return this.updateInventoryItem(itemId, {
      expiration_date: expirationDate,
      ...(alertDays !== undefined ? { expiration_alert_days: alertDays } : {}),
    });
  },

  async moveToArea(itemId: string, storageAreaId: string | null): Promise<InventoryItem> {
    return this.updateInventoryItem(itemId, { storage_area_id: storageAreaId });
  },

  /**
   * The heart: flag this item as something to buy more of.
   *
   * A plain column write — `need_to_buy` is independent of status, so an item
   * that is still in stock can carry it. The database clears the flag on its own
   * when the quantity goes up, so restocking needs no call from here.
   */
  async setNeedToBuy(itemId: string, needToBuy: boolean): Promise<InventoryItem> {
    return this.updateInventoryItem(itemId, { need_to_buy: needToBuy });
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

  // ---- History -------------------------------------------------------------

  /**
   * The audit trail. Rows are written by a database trigger, so this is a true
   * record of what happened rather than a log the client remembered to keep —
   * including changes made from a teammate's device.
   */
  async getTransactions(userId: string, limit = 100): Promise<InventoryTransaction[]> {
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getItemTransactions(itemId: string, limit = 50): Promise<InventoryTransaction[]> {
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select('*')
      .eq('inventory_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
};
