// Bulk inventory — Food Establishment Pro.
//
// Every write goes through a SECURITY DEFINER RPC rather than a loop of client
// inserts, for three reasons:
//   * a batch either lands completely or not at all — capacity is validated for
//     the whole set before anything is written;
//   * one authorised call instead of N round-trips that can fail halfway;
//   * the entitlement check happens server-side, so it cannot be skipped.
//
// The parsers below are pure so the paste-in preview can run as the user types,
// without touching the network.

import { supabase } from '../lib/supabase';
import type { InventoryItem } from '../types';

/** The fields a bulk add accepts. Anything absent falls back to the DB default. */
export interface BulkInventoryDraft {
  product_name: string;
  brand?: string | null;
  category?: string | null;
  quantity?: number;
  unit?: string;
  purchase_date?: string | null;
  expiration_date?: string | null;
  price?: number | null;
  barcode?: string | null;
  notes?: string | null;
  storage_area_id?: string | null;
  expiration_alert_days?: number;
}

/** Fields a bulk edit may change. Quantity is excluded — it has its own call. */
export interface BulkUpdateFields {
  category?: string;
  unit?: string;
  storage_area_id?: string | null;
  expiration_date?: string | null;
  expiration_alert_days?: number;
}

/** A parsed row plus why it was rejected, so the preview can explain itself. */
export interface ParsedBulkRow {
  draft: BulkInventoryDraft | null;
  raw: string;
  lineNumber: number;
  problem?: string;
}

/** The header names `parseBulkText` recognises, in the order we suggest them. */
export const BULK_COLUMNS = [
  'product_name',
  'quantity',
  'unit',
  'category',
  'expiration_date',
  'price',
] as const;

/**
 * Accepts either a CSV/TSV paste or a header-less list.
 *
 * With a recognised header row the column order does not matter; without one we
 * fall back to the documented order above, which is what the on-screen hint
 * shows. Blank lines and `#` comments are skipped so a spreadsheet paste can
 * keep its own notes.
 */
export function parseBulkText(text: string): ParsedBulkRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) return [];

  const delimiter = lines[0].line.includes('\t') ? '\t' : ',';
  const split = (line: string) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));

  const firstCells = split(lines[0].line).map((cell) => cell.toLowerCase().replace(/\s+/g, '_'));
  const hasHeader = firstCells.includes('product_name') || firstCells.includes('name');

  const header = hasHeader
    ? firstCells.map((cell) => (cell === 'name' ? 'product_name' : cell))
    : [...BULK_COLUMNS];

  const body = hasHeader ? lines.slice(1) : lines;

  return body.map(({ line, lineNumber }) => {
    const cells = split(line);
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      if (cells[index] !== undefined && cells[index] !== '') record[key] = cells[index];
    });

    const name = record.product_name?.trim();
    if (!name) {
      return { draft: null, raw: line, lineNumber, problem: 'No product name' };
    }

    const quantity = record.quantity !== undefined ? Number(record.quantity) : undefined;
    if (quantity !== undefined && !Number.isFinite(quantity)) {
      return { draft: null, raw: line, lineNumber, problem: `"${record.quantity}" is not a number` };
    }

    const price = record.price !== undefined ? Number(record.price) : undefined;
    if (price !== undefined && !Number.isFinite(price)) {
      return { draft: null, raw: line, lineNumber, problem: `"${record.price}" is not a price` };
    }

    const expiration = record.expiration_date?.trim();
    if (expiration && Number.isNaN(new Date(expiration).getTime())) {
      return {
        draft: null,
        raw: line,
        lineNumber,
        problem: `"${expiration}" is not a date (use YYYY-MM-DD)`,
      };
    }

    return {
      draft: {
        product_name: name,
        quantity: quantity !== undefined ? Math.max(quantity, 0) : 1,
        unit: record.unit || 'pcs',
        category: record.category || null,
        expiration_date: expiration || null,
        price: price ?? null,
      },
      raw: line,
      lineNumber,
    };
  });
}

/** The inverse, so an existing selection can be exported back out for editing. */
export function toBulkText(items: Pick<InventoryItem, 'product_name' | 'quantity' | 'unit' | 'category' | 'expiration_date' | 'price'>[]): string {
  const rows = items.map((item) =>
    [
      item.product_name ?? '',
      item.quantity ?? '',
      item.unit ?? '',
      item.category ?? '',
      item.expiration_date ?? '',
      item.price ?? '',
    ]
      .map((cell) => {
        const value = String(cell);
        return value.includes(',') ? `"${value}"` : value;
      })
      .join(',')
  );
  return [BULK_COLUMNS.join(','), ...rows].join('\n');
}

export const bulkInventoryService = {
  /**
   * Insert many items at once. Returns the created rows so the caller can
   * reconcile its list without a refetch.
   */
  async bulkAdd(items: BulkInventoryDraft[]): Promise<InventoryItem[]> {
    if (items.length === 0) return [];
    const { data, error } = await supabase.rpc('bulk_add_inventory', { p_items: items });
    if (error) throw error;
    return (data ?? []) as InventoryItem[];
  },

  /** Apply the same field changes across a selection. Returns rows affected. */
  async bulkUpdate(itemIds: string[], updates: BulkUpdateFields): Promise<number> {
    if (itemIds.length === 0) return 0;
    const { data, error } = await supabase.rpc('bulk_update_inventory', {
      p_item_ids: itemIds,
      p_updates: updates,
    });
    if (error) throw error;
    return Number(data ?? 0);
  },

  /**
   * Add or subtract the same amount across a selection. The database clamps at
   * zero, so a bulk "−1" on a shelf of ones empties it rather than going
   * negative.
   */
  async bulkAdjustQuantity(itemIds: string[], delta: number): Promise<number> {
    if (itemIds.length === 0 || delta === 0) return 0;
    const { data, error } = await supabase.rpc('bulk_adjust_quantity', {
      p_item_ids: itemIds,
      p_delta: delta,
    });
    if (error) throw error;
    return Number(data ?? 0);
  },

  async bulkDelete(itemIds: string[]): Promise<number> {
    if (itemIds.length === 0) return 0;
    const { data, error } = await supabase.rpc('bulk_delete_inventory', {
      p_item_ids: itemIds,
    });
    if (error) throw error;
    return Number(data ?? 0);
  },
};
