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

/**
 * A ledger row plus the category of the inventory item it came from.
 *
 * `price_history` records what a thing cost, not what kind of thing it is, so
 * the category is read through the item link rather than copied onto every row
 * — a product re-categorised in the inventory is then re-categorised here too,
 * instead of leaving its old history wearing the old icon.
 *
 * Null in the two cases that both still have to render: a price logged by hand
 * for something that was never in the inventory, and a row whose item has since
 * been deleted (`inventory_item_id` is `ON DELETE SET NULL`). Both fall back to
 * the generic category icon.
 */
export type PriceHistoryRow = PriceHistoryEntry & {
  inventory_items: { category: string | null } | null;
};

/** Per-product roll-up: what it costs now versus what it cost before. */
export interface ProductPriceSummary {
  productName: string;
  barcode: string | null;
  /** Stored category of the linked inventory item, in whatever spelling it was saved. */
  category: string | null;
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

/**
 * What the summary card needs, in one object.
 *
 * Two windows are returned rather than one, because the segmented control asks
 * "this month" and "last 6 months" of the same data and switching between them
 * must not cost a refetch.
 */
export interface SpendSummary {
  /** The chart window — the last 6 calendar months, oldest → newest. */
  trend: { label: string; value: number }[];
  /** Total for the current calendar month. */
  thisMonth: number;
  /** Total for the month before it. */
  lastMonth: number;
  /** Total across `trend`. */
  window: number;
  /** Total across the 6 months immediately before `trend`. */
  priorWindow: number;
}

/**
 * How prices moved over a window, split by direction.
 *
 * An average rather than a total. Summing the percentages would count a ₱24
 * tin's swing the same as a ₱1,450 steak's, and summing the pesos would let the
 * steak drown out everything else — neither answers "how far did prices move".
 * The average says: of the things that went up, roughly this far.
 */
export interface PriceMovement {
  /** Products that got more expensive, and the average size of that rise. */
  up: { count: number; avgPercent: number };
  /** Products that got cheaper, and the average size of that fall. Always positive. */
  down: { count: number; avgPercent: number };
}

export interface PriceOverview {
  products: ProductPriceSummary[];
  spend: SpendSummary;
  movement: PriceMovement;
}

/** `YYYY-MM` in local time — the bucket key for a month. */
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Pesos are displayed to two decimals. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Percentages are displayed to one decimal, so they are averaged at that precision. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The last `n` calendar months, oldest first, including months nothing was
 * bought in.
 *
 * Built from the calendar rather than from the ledger's own distinct months:
 * deriving the axis from the months that happen to have rows silently closes
 * the gaps, so a quiet June would slide July into its place and the chart would
 * claim a run of consecutive spending that never happened.
 */
function lastNMonths(n: number): { key: string; label: string }[] {
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let back = n - 1; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: 'short' }) });
  }
  return months;
}

/**
 * Roll the ledger up per product, newest observation first.
 *
 * `change` compares the two most recent observations rather than a fixed
 * window, because prices are recorded irregularly — "since last time" is the
 * number a shopper can actually act on.
 */
function summarizeProducts(rows: PriceHistoryRow[]): ProductPriceSummary[] {
  const byProduct = new Map<string, PriceHistoryRow[]>();
  rows.forEach((row) => {
    const key = row.product_name?.trim();
    if (!key) return;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(row);
  });

  const summaries: ProductPriceSummary[] = [];

  byProduct.forEach((productRows, productName) => {
    // `rows` is newest-first; reverse for a chronological trend.
    const chronological = [...productRows].reverse();
    const latest = chronological[chronological.length - 1];
    const previous = chronological.length > 1 ? chronological[chronological.length - 2] : null;

    const currentPrice = Number(latest.price);
    const previousPrice = previous ? Number(previous.price) : null;
    const change = previousPrice != null ? currentPrice - previousPrice : 0;

    summaries.push({
      productName,
      barcode: latest.barcode ?? null,
      // The newest row wins, because it is the one whose item link is most
      // likely to still resolve — an older row loses it when the item it
      // described is deleted and re-added.
      category: latest.inventory_items?.category ?? null,
      currentPrice,
      previousPrice,
      change,
      changePercent:
        previousPrice != null && previousPrice > 0
          // One decimal, not a whole number: grocery prices move by a few
          // percent, and rounding 2.4% and 1.6% both to "2%" hides exactly the
          // difference the badge is there to show.
          ? Math.round((change / previousPrice) * 1000) / 10
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
}

/**
 * Bucket the ledger into the last 12 calendar months and cut the two windows
 * the segmented control switches between.
 *
 * Twelve months are bucketed to fill a six-month chart so there is a genuine
 * "before" to compare against — comparing the chart's own six months to itself
 * would always report a change of zero.
 */
function summarizeSpend(rows: PriceHistoryRow[]): SpendSummary {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const key = monthKey(new Date(row.recorded_at));
    totals.set(key, (totals.get(key) ?? 0) + Number(row.price));
  });

  const months = lastNMonths(12).map((m) => ({
    label: m.label,
    value: round2(totals.get(m.key) ?? 0),
  }));
  const trend = months.slice(-6);
  const prior = months.slice(0, 6);
  const sum = (xs: { value: number }[]) => round2(xs.reduce((acc, x) => acc + x.value, 0));

  return {
    trend,
    // Read off `trend` rather than recomputed, so the headline figure and the
    // last two points of the line can never disagree about what a month cost.
    thisMonth: trend[trend.length - 1]?.value ?? 0,
    lastMonth: trend[trend.length - 2]?.value ?? 0,
    window: sum(trend),
    priorWindow: sum(prior),
  };
}

/**
 * Movement over the last `days`, taken from each product's most recent change.
 *
 * A rolling window rather than a calendar month: on the 1st, a calendar-month
 * filter would report nothing at all and then fill up over the following weeks,
 * so the counts would climb for reasons that have nothing to do with prices.
 * Thirty days back is always thirty days of news.
 *
 * Products with only one observation are left out. With no previous price there
 * is no change to average, and counting them as 0% would drag both figures
 * toward zero and make a month of real movement look like a flat one. Products
 * whose price held steady drop out on the same reasoning — they belong to
 * neither direction, and the count is meant to be "how many went up" rather
 * than "how many didn't go down".
 */
function summarizeMovement(products: ProductPriceSummary[], days = 30): PriceMovement {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const moved = products.filter(
    (p) => p.previousPrice != null && new Date(p.lastRecordedAt).getTime() >= cutoff
  );

  const rises = moved.filter((p) => p.changePercent > 0).map((p) => p.changePercent);
  // Negated so both sides are positive magnitudes; the direction is the
  // heading's job, not the number's, and "-3.1% down" reads as a double
  // negative.
  const falls = moved.filter((p) => p.changePercent < 0).map((p) => -p.changePercent);
  const mean = (xs: number[]) =>
    xs.length ? round1(xs.reduce((total, x) => total + x, 0) / xs.length) : 0;

  return {
    up: { count: rises.length, avgPercent: mean(rises) },
    down: { count: falls.length, avgPercent: mean(falls) },
  };
}

export const priceTrackingService = {
  /**
   * The raw ledger, newest first.
   *
   * `inventory_items(category)` rides along on the same query rather than
   * costing a second round trip per product — the embed follows the
   * `inventory_item_id` foreign key, so a row whose item is gone simply comes
   * back with the join null.
   */
  async recentEntries(userId: string, limit = 100): Promise<PriceHistoryRow[]> {
    const { data, error } = await supabase
      .from('price_history')
      .select('*, inventory_items(category)')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PriceHistoryRow[];
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
   * Everything the screen draws, from one read of the ledger.
   *
   * One query rather than one per section: the summary card and the product
   * list are two views of the same rows, and fetching them separately let a
   * price recorded in between land in the list while the chart still showed the
   * old total.
   */
  async overview(userId: string): Promise<PriceOverview> {
    // 1000 covers a year of history for a household and the great majority of
    // establishments. Past it only the oldest rows fall off the far end of the
    // spend window, which understates a month rather than inventing one.
    const rows = await this.recentEntries(userId, 1000);
    const products = summarizeProducts(rows);
    return {
      products,
      spend: summarizeSpend(rows),
      // Derived from the same roll-up the list below renders, so the card's
      // "3 up" can never disagree with the three red badges in that list.
      movement: summarizeMovement(products),
    };
  },

  /** Just the product roll-up, for callers that need nothing else. */
  async productSummaries(userId: string): Promise<ProductPriceSummary[]> {
    return summarizeProducts(await this.recentEntries(userId, 500));
  },

  /**
   * Log a price seen at the till, for a product that isn't in inventory (or is
   * stocked out). Item-driven changes are captured by the trigger instead.
   *
   * A hand-logged price carries no `inventory_item_id`, so it has no category
   * and renders with the generic icon — the trigger-written rows are the ones
   * that inherit one.
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
};
