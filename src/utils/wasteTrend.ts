// Bucketing for the dashboard's Food Waste Trend.
//
// The chart follows a range the user picks, so the bucket size has to follow the
// range too: a fortnight of waste drawn as one monthly bar says nothing, and two
// years of it drawn by the day is more bars than the card can hold. The unit is
// therefore chosen from the span, smallest first, to land inside what fits.
//
// Calendar dates are resolved in the app's timezone — the same one the date
// pickers produce their keys in — so a row binned late on the last day of a
// month lands in the bucket the user pointed at, not in the next one.
//
// Kept separate from the screen and free of Supabase so the bucketing can be
// reasoned about on its own.

import moment from 'moment-timezone';
import type { Moment } from 'moment-timezone';
import { APP_TIMEZONE, parseDateKey, todayKey } from './dateKey';

export type BucketUnit = 'day' | 'week' | 'month';

export interface TrendBucket {
  /** Short axis label, sized for the narrowest column the chart draws. */
  label: string;
  /** How many waste rows fall in this bucket. */
  value: number;
}

/**
 * How many month buckets the trend will draw at most.
 *
 * This is a column budget, not a span: past this many bars the columns are too
 * thin to compare, so the picker refuses to go further back rather than quietly
 * drawing something unreadable. It is also why the floor is eleven months rather
 * than twelve — a range reaching a full twelve months back is aligned to the
 * start of its month and lands on thirteen bars, whose first and last then carry
 * the same month name on an axis with no room to say which year is which.
 */
export const MAX_RANGE_MONTHS = 12;

/**
 * How finely to bucket a span.
 *
 * The card fits about fourteen columns before the bars collide, so the unit is
 * picked to land inside that rather than to follow the calendar. The thresholds
 * are the spans whose bucket count would first exceed it.
 */
function unitForSpan(spanDays: number): BucketUnit {
  if (spanDays <= 13) return 'day';
  if (spanDays <= 84) return 'week';
  return 'month';
}

/** Midnight at the start of a calendar key, in the app's timezone. */
function startOfKey(key: string): Moment {
  const parts = parseDateKey(key) ?? parseDateKey(todayKey())!;
  // Built from parts rather than parsed from the string, so no format string
  // stands between the key and the instant.
  return moment.tz([parts.y, parts.m, parts.d], APP_TIMEZONE).startOf('day');
}

/** Which bucket an instant belongs to, as the key that bucket was created under. */
function bucketKey(instant: Moment, unit: BucketUnit): string {
  if (unit === 'day') return instant.format('YYYY-MM-DD');
  if (unit === 'week') return instant.clone().startOf('isoWeek').format('YYYY-MM-DD');
  return instant.format('YYYY-MM');
}

/**
 * A label short enough to sit under a bar.
 *
 * Day and week buckets get just the date: fourteen columns of "12 Mar" would
 * overlap, and the chip above the chart already names the range the numbers
 * belong to. Month buckets keep the month name, which is unambiguous at the
 * twelve columns that unit is used for.
 */
function bucketLabel(instant: Moment, unit: BucketUnit): string {
  return unit === 'month' ? instant.format('MMM') : instant.format('D');
}

/** The start of the selected trend range, as an ISO timestamp. */
export function queryStartIso(startKey: string): string {
  return startOfKey(startKey).toISOString();
}

/**
 * The trend for one range: a bucket per unit of time, counted from real rows.
 *
 * Rows outside the range are ignored rather than clamped into the outermost
 * buckets, so a bar only ever means "this much was binned in this period".
 */
export function buildWasteTrend(
  rows: { wasted_at: string }[],
  startKey: string,
  endKey: string
): { unit: BucketUnit; buckets: TrendBucket[] } {
  const start = startOfKey(startKey);
  const end = startOfKey(endKey);
  // Swapped rather than rejected: a range that arrived the wrong way round is
  // still a span the user asked about, so it is read as the span it describes
  // instead of drawing an empty chart and leaving them to work out why.
  const from = start.isAfter(end) ? end.clone() : start;
  const to = start.isAfter(end) ? start.clone() : end;

  const unit = unitForSpan(to.diff(from, 'days'));
  // The last day is included whole, so a row binned at 23:00 on the end date is
  // in the range — the same reading the picker's "To" invites.
  const lastInstant = to.clone().endOf('day');

  const buckets = new Map<string, TrendBucket>();
  const cursor = from.clone();
  // Aligned to the start of its own week or month, so the first bucket covers a
  // whole period rather than a partial one beginning mid-week.
  if (unit === 'week') cursor.startOf('isoWeek');
  if (unit === 'month') cursor.startOf('month');

  // Bounded by construction: the caller caps the range at MAX_RANGE_MONTHS, and
  // the unit shrinks to keep the count near fourteen below that. The guard is
  // here so a range that slipped through could never spin the render.
  const guard = 400;
  let steps = 0;
  while (cursor.isSameOrBefore(to) && steps < guard) {
    // The first bucket can start before the range — a week aligned back to its
    // Monday, a month back to its 1st. Its label is clamped to the range so the
    // axis never shows a date the chip above it excludes, which is only ever a
    // question the user cannot answer. The bucket's *key* stays the aligned
    // start, because that is what the rows were filed under.
    const labelFrom = cursor.isBefore(from) ? from : cursor;
    buckets.set(bucketKey(cursor, unit), { label: bucketLabel(labelFrom, unit), value: 0 });
    cursor.add(1, unit);
    steps += 1;
  }

  rows.forEach((row) => {
    const at = dayInAppZone(row.wasted_at);
    // Skipped, not clamped. The outermost buckets cover whole weeks and months,
    // so without this a row binned after the range would be drawn as though it
    // fell inside the range the user chose — the bar would be right about the
    // week and wrong about the question.
    if (at.isBefore(from) || at.isAfter(lastInstant)) return;

    const bucket = buckets.get(bucketKey(at, unit));
    // No bucket means the row is outside the range, which is not the chart's to
    // show — not a row to fold into the nearest bar.
    if (bucket) bucket.value += 1;
  });

  return { unit, buckets: [...buckets.values()] };
}

/**
 * The default range: the last six months, ending today.
 *
 * Six is what the card was built around before the range was selectable, so the
 * chart still opens on the view people already know.
 */
export function defaultRange(): { start: string; end: string } {
  const end = moment.tz(todayKey(), APP_TIMEZONE).startOf('day');
  return {
    start: end.clone().subtract(5, 'month').startOf('month').format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  };
}

/**
 * The earliest day the picker will offer, so the range cannot exceed the cap.
 *
 * Eleven months back, not twelve: the buckets align to the start of their month,
 * so twelve months of span is thirteen bars — the first and last of which share a
 * month name on an axis with no width to disambiguate them. Eleven keeps the
 * deepest range at exactly `MAX_RANGE_MONTHS` buckets, each one distinct.
 */
export function earliestSelectableKey(): string {
  return moment.tz(todayKey(), APP_TIMEZONE).startOf('day')
    .subtract(MAX_RANGE_MONTHS - 1, 'month').startOf('month').format('YYYY-MM-DD');
}

/**
 * The range as one line, for the chip above the chart.
 *
 * The year is carried once when both ends share it, and on both ends when the
 * range crosses a new year — where a lone year would be read as belonging to the
 * wrong date.
 */
export function formatRangeLabel(startKey: string, endKey: string): string {
  const start = startOfKey(startKey);
  const end = startOfKey(endKey);
  return start.year() === end.year()
    ? `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`
    : `${start.format('D MMM YYYY')} – ${end.format('D MMM YYYY')}`;
}

/** How the buckets should be read, named for the chip's neighbours. */
export function unitLabel(unit: BucketUnit): string {
  return unit === 'day' ? 'Daily' : unit === 'week' ? 'Weekly' : 'Monthly';
}
