// Food waste & savings reporting.
//
// Two tiers, matching the entitlement matrix:
//   * `waste_report`          — totals, waste rate, category/product breakdown.
//   * `advanced_waste_report` — adds reason analysis, per-period trend and
//                               cost projections.
//
// Rows come from `food_waste` (written when an item is binned) and
// `inventory_consumption` (written when an item is used). Both carry an
// `estimated_value`, so the report is expressed in pesos rather than guesses.
//
// Everything above the raw rows is computed here rather than in SQL: the
// dataset per household is small, and keeping the maths in TypeScript means the
// report renders identically offline from cached rows.

import { supabase } from '../lib/supabase';
import type { ReportWindow, WasteReport } from '../types';

/** A row as it comes back from PostgREST with its item embedded. */
interface WasteRow {
  estimated_value: number | null;
  quantity: number | null;
  reason: string | null;
  wasted_at: string;
  inventory_items:
    | { product_name: string | null; category: string | null }
    | { product_name: string | null; category: string | null }[]
    | null;
}

interface ConsumptionRow {
  quantity: number | null;
  consumed_at: string;
  inventory_items: { price: number | null; product_name: string | null } | null;
}

/**
 * PostgREST returns an embedded to-one relation as an object, but an
 * ambiguous or to-many relation as an array. Normalise both.
 */
function embedded<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Inclusive start of the window, and how many buckets the trend gets. */
function windowRange(window: ReportWindow, now = new Date()): {
  start: Date;
  buckets: number;
  bucketUnit: 'day' | 'week' | 'month';
} {
  switch (window) {
    case 'daily':
      // "Daily" means today, broken into the preceding 7 days for the trend.
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), buckets: 7, bucketUnit: 'day' };
    case 'weekly': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, buckets: 8, bucketUnit: 'week' };
    }
    case 'yearly': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, buckets: 12, bucketUnit: 'month' };
    }
    case 'monthly':
    default: {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, buckets: 6, bucketUnit: 'month' };
    }
  }
}

function bucketLabel(date: Date, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'day') return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (unit === 'week') return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short' });
}

/** Stable key for a date so rows can be grouped without a library. */
function bucketKey(date: Date, unit: 'day' | 'week' | 'month'): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (unit === 'day') return `${year}-${month}-${date.getDate()}`;
  if (unit === 'week') {
    // Week-of-year, Monday-based, so buckets don't straddle a month boundary.
    const monday = new Date(date);
    const day = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
  }
  return `${year}-${month}`;
}

export const wasteReportService = {
  /**
   * Build the report for a window.
   *
   * `advanced` only controls how much is computed — access itself is enforced
   * by the entitlement gate on the screen, so a basic-plan caller simply asks
   * for `advanced: false`.
   */
  async getReport(
    userId: string,
    window: ReportWindow = 'monthly',
    advanced = false
  ): Promise<WasteReport> {
    const { start, buckets, bucketUnit } = windowRange(window);
    const startIso = start.toISOString();
    const endIso = new Date().toISOString();

    const [wasteResult, consumptionResult] = await Promise.all([
      supabase
        .from('food_waste')
        .select('estimated_value, quantity, reason, wasted_at, inventory_items(product_name, category)')
        .eq('user_id', userId)
        .gte('wasted_at', startIso)
        .lte('wasted_at', endIso)
        .order('wasted_at', { ascending: false }),
      supabase
        .from('inventory_consumption')
        .select('quantity, consumed_at, inventory_items(price, product_name)')
        .eq('user_id', userId)
        .gte('consumed_at', startIso)
        .lte('consumed_at', endIso),
    ]);

    if (wasteResult.error) throw wasteResult.error;
    // Consumption is best-effort: a missing row should not blank the report.
    const wasteRows = (wasteResult.data ?? []) as unknown as WasteRow[];
    const consumptionRows = (consumptionResult.data ?? []) as unknown as ConsumptionRow[];

    const wastedValue = wasteRows.reduce((sum, row) => sum + Number(row.estimated_value ?? 0), 0);
    const wastedItems = wasteRows.length;

    const consumedValue = consumptionRows.reduce((sum, row) => {
      const item = embedded(row.inventory_items);
      const price = Number(item?.price ?? 0);
      return sum + price * Number(row.quantity ?? 0);
    }, 0);

    // Waste rate = wasted ÷ everything that left the pantry, so it stays
    // meaningful even in a month with no purchases.
    const outflow = wastedValue + consumedValue;
    const wastePercent = outflow > 0 ? Math.round((wastedValue / outflow) * 100) : 0;
    const savingsPercent = outflow > 0 ? 100 - wastePercent : 0;

    // ---- Category breakdown -------------------------------------------------
    const categoryTotals = new Map<string, { value: number; count: number }>();
    const productTotals = new Map<string, { value: number; count: number }>();
    const reasonTotals = new Map<string, { value: number; count: number }>();

    wasteRows.forEach((row) => {
      const item = embedded(row.inventory_items);
      const value = Number(row.estimated_value ?? 0);

      const category = item?.category?.trim() || 'Uncategorised';
      const product = item?.product_name?.trim() || 'Unnamed item';

      const cat = categoryTotals.get(category) ?? { value: 0, count: 0 };
      cat.value += value;
      cat.count += 1;
      categoryTotals.set(category, cat);

      const prod = productTotals.get(product) ?? { value: 0, count: 0 };
      prod.value += value;
      prod.count += 1;
      productTotals.set(product, prod);

      if (advanced) {
        const reason = row.reason?.trim() || 'Not recorded';
        const entry = reasonTotals.get(reason) ?? { value: 0, count: 0 };
        entry.value += value;
        entry.count += 1;
        reasonTotals.set(reason, entry);
      }
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const toSorted = (map: Map<string, { value: number; count: number }>) =>
      [...map.entries()]
        .map(([name, agg]) => ({ label: name, name, value: round2(agg.value), count: agg.count }))
        .sort((a, b) => b.value - a.value);

    // ---- Trend --------------------------------------------------------------
    // Seed every bucket with zero so gaps read as zero waste, not as a missing
    // point that shifts the chart.
    const trendBuckets = new Map<string, { label: string; value: number; count: number }>();
    for (let i = buckets - 1; i >= 0; i -= 1) {
      const date = new Date();
      if (bucketUnit === 'day') date.setDate(date.getDate() - i);
      else if (bucketUnit === 'week') date.setDate(date.getDate() - i * 7);
      else date.setMonth(date.getMonth() - i);
      trendBuckets.set(bucketKey(date, bucketUnit), {
        label: bucketLabel(date, bucketUnit),
        value: 0,
        count: 0,
      });
    }

    wasteRows.forEach((row) => {
      const key = bucketKey(new Date(row.wasted_at), bucketUnit);
      const bucket = trendBuckets.get(key);
      if (!bucket) return;
      bucket.value += Number(row.estimated_value ?? 0);
      bucket.count += 1;
    });

    const trend = [...trendBuckets.values()].map((bucket) => ({
      ...bucket,
      value: round2(bucket.value),
    }));

    // Average per bucket, used for the advanced projection.
    const bucketCount = Math.max(trend.length, 1);
    const averagePerBucket = round2(wastedValue / bucketCount);

    return {
      window,
      periodStart: startIso,
      periodEnd: endIso,
      wastedValue: round2(wastedValue),
      itemsWasted: wastedItems,
      consumedValue: round2(consumedValue),
      itemsConsumed: consumptionRows.length,
      estimatedSavings: round2(consumedValue),
      wastePercent,
      savingsPercent,
      currency: 'PHP',
      byCategory: toSorted(categoryTotals).map(({ label, value, count }) => ({ label, value, count })),
      topProducts: toSorted(productTotals)
        .slice(0, advanced ? 10 : 5)
        .map(({ name, value, count }) => ({ name, value, count })),
      trend,
      // Only populated for advanced plans; the column is optional in the type.
      ...(advanced
        ? {
            byReason: toSorted(reasonTotals).map(({ label, value, count }) => ({ label, value, count })),
            averagePerBucket,
            projectedYearlyWaste: round2(
              averagePerBucket *
                (bucketUnit === 'day' ? 365 : bucketUnit === 'week' ? 52 : 12)
            ),
          }
        : {}),
    };
  },

  /** Convenience wrapper used by the report screen's segmented control. */
  async getAllWindows(userId: string, advanced = false): Promise<Record<ReportWindow, WasteReport>> {
    const windows: ReportWindow[] = ['daily', 'weekly', 'monthly', 'yearly'];
    const reports = await Promise.all(
      windows.map((window) => this.getReport(userId, window, advanced))
    );
    return windows.reduce((acc, window, index) => {
      acc[window] = reports[index];
      return acc;
    }, {} as Record<ReportWindow, WasteReport>);
  },
};
