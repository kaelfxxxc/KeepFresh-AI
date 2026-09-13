// Price tracking.
//
// History rows are written automatically by a database trigger whenever an
// item's `price` changes (and once when an item is created with a price), so
// nothing is lost if a client forgets to record it. Read access is gated by the
// `price_tracking` entitlement in RLS — which means a Free Trial user gets an
// empty list rather than an error, and upgrading immediately reveals the
// history that was being collected all along.

import { supabase } from '../lib/supabase';
import type { PriceHistoryEntry } from '../types';

/** Per-product roll-up: what it costs now versus what it cost before. */
export interface ProductPriceSummary {
  productName: string;
  barcode: string | null;
  currentPrice: number;
  previousPrice: number | null;
  /** currentPrice − previousPrice. Positive means it got more expensive. */
  change: number;
  /** Change as a percentage of the previous price. */
  changePercent: number;
  observations: number;
  lastRecordedAt: string;
  /** Oldest → newest, for a sparkline. */
  trend: { label: string; value: number }[];
}

export const priceTrackingService = {
  /** The raw ledger, newest first. */
  async recentEntries(userId: string, limit = 100): Promise<PriceHistoryEntry[]> {
    const { data, error } = await supabase
      .from('price_history')
      .select('*')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async historyForProduct(userId: string, productName: string): Promise<PriceHistoryEntry[]> {
    const { data, error } = await supabase
      .from('price_history')
      .select('*')
      .eq('user_id', userId)
      .eq('product_name', productName)
      .order('recorded_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Roll the ledger up per product, newest observation first.
   *
   * `change` compares the two most recent observations rather than a fixed
   * window, because prices are recorded irregularly — "since last time" is the
   * number a shopper can actually act on.
   */
  async productSummaries(userId: string): Promise<ProductPriceSummary[]> {
    const entries = await this.recentEntries(userId, 500);

    const byProduct = new Map<string, PriceHistoryEntry[]>();
    entries.forEach((entry) => {
      const key = entry.product_name?.trim();
      if (!key) return;
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key)!.push(entry);
    });

    const summaries: ProductPriceSummary[] = [];

    byProduct.forEach((rows, productName) => {
      // `recentEntries` is newest-first; reverse for a chronological trend.
      const chronological = [...rows].reverse();
      const latest = chronological[chronological.length - 1];
      const previous = chronological.length > 1 ? chronological[chronological.length - 2] : null;

      const currentPrice = Number(latest.price);
      const previousPrice = previous ? Number(previous.price) : null;
      const change = previousPrice != null ? currentPrice - previousPrice : 0;

      summaries.push({
        productName,
        barcode: latest.barcode ?? null,
        currentPrice,
        previousPrice,
        change,
        changePercent:
          previousPrice != null && previousPrice > 0
            ? Math.round((change / previousPrice) * 100)
            : 0,
        observations: chronological.length,
        lastRecordedAt: latest.recorded_at,
        trend: chronological.slice(-8).map((row) => ({
          label: new Date(row.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          value: Number(row.price),
        })),
      });
    });

    return summaries.sort(
      (a, b) => new Date(b.lastRecordedAt).getTime() - new Date(a.lastRecordedAt).getTime()
    );
  },

  /**
   * Log a price seen at the till, for a product that isn't in inventory (or is
   * stocked out). Item-driven changes are captured by the trigger instead.
   */
  async recordPrice(
    userId: string,
    input: {
      productName: string;
      price: number;
      inventoryItemId?: string | null;
      barcode?: string | null;
      supplier?: string | null;
      purchaseDate?: string | null;
    }
  ): Promise<PriceHistoryEntry> {
    const { data, error } = await supabase
      .from('price_history')
      .insert({
        user_id: userId,
        inventory_item_id: input.inventoryItemId ?? null,
        product_name: input.productName.trim(),
        barcode: input.barcode ?? null,
        price: input.price,
        supplier: input.supplier ?? null,
        purchase_date: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
        recorded_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Total spent per month, newest first — the "what groceries cost me" line. */
  async monthlySpend(userId: string, months = 6): Promise<{ label: string; value: number }[]> {
    const entries = await this.recentEntries(userId, 500);
    const buckets = new Map<string, number>();

    entries.forEach((entry) => {
      const date = new Date(entry.recorded_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, (buckets.get(key) ?? 0) + Number(entry.price));
    });

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-months)
      .map(([key, value]) => {
        const [year, month] = key.split('-').map(Number);
        return {
          label: new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short' }),
          value: Math.round(value * 100) / 100,
        };
      });
  },
};
