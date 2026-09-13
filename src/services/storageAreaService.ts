// Storage areas — refrigerator, freezer, pantry, cabinet, or custom.
//
// Creating an area is gated by the `multiple_storage` entitlement in a database
// trigger, so a plan-limited account cannot sneak past the cap. The UI checks
// first with `gateUseMultipleStorage` so the user sees an upgrade prompt rather
// than a raw error.

import { supabase } from '../lib/supabase';
import type { StorageArea, StorageKind } from '../types';

export const STORAGE_KINDS: { value: StorageKind; label: string; emoji: string }[] = [
  { value: 'refrigerator', label: 'Refrigerator', emoji: '🧊' },
  { value: 'freezer', label: 'Freezer', emoji: '❄️' },
  { value: 'pantry', label: 'Pantry', emoji: '🥫' },
  { value: 'cabinet', label: 'Cabinet', emoji: '🗄️' },
  { value: 'custom', label: 'Custom', emoji: '📦' },
];

export function storageEmoji(area: Pick<StorageArea, 'kind'> | null | undefined): string {
  return STORAGE_KINDS.find((k) => k.value === area?.kind)?.emoji ?? '📦';
}

export const storageAreaService = {
  async list(userId: string): Promise<StorageArea[]> {
    const { data, error } = await supabase
      .from('storage_areas')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /** The area a new item lands in when the user doesn't pick one. */
  async getDefault(userId: string): Promise<StorageArea | null> {
    const { data, error } = await supabase
      .from('storage_areas')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },

  async create(
    userId: string,
    input: { name: string; kind: StorageKind; icon?: string | null }
  ): Promise<StorageArea> {
    const { data, error } = await supabase
      .from('storage_areas')
      .insert({
        user_id: userId,
        name: input.name.trim(),
        kind: input.kind,
        icon: input.icon ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(
    id: string,
    updates: Partial<Pick<StorageArea, 'name' | 'kind' | 'icon'>>
  ): Promise<StorageArea> {
    const { data, error } = await supabase
      .from('storage_areas')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Delete an area. Items inside it are NOT deleted — the foreign key is
   * ON DELETE SET NULL, so they simply become unassigned and stay in inventory.
   */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('storage_areas').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * How many live items sit in each area, keyed by area id. Used for the
   * filter chips and the manage screen's counts.
   */
  async itemCounts(userId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('storage_area_id')
      .eq('user_id', userId)
      .not('storage_area_id', 'is', null)
      .not('status', 'in', '(consumed,wasted)');
    if (error) throw error;

    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: { storage_area_id: string | null }) => {
      if (!row.storage_area_id) return;
      counts[row.storage_area_id] = (counts[row.storage_area_id] ?? 0) + 1;
    });
    return counts;
  },

  /** Items with no area assigned — the "Unassigned" filter bucket. */
  async unassignedCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('storage_area_id', null)
      .not('status', 'in', '(consumed,wasted)');
    if (error) throw error;
    return count ?? 0;
  },
};
