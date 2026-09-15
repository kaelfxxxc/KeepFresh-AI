import moment from 'moment-timezone';

/**
 * The app's calendar timezone.
 *
 * Dates are stored as bare `YYYY-MM-DD` keys, so "today" has to mean today
 * somewhere specific — and it has to be the same somewhere the expiration
 * status is judged, or an item can read as expiring tomorrow in one place and
 * today in another. `getExpirationStatus` already resolves against this zone.
 */
export const APP_TIMEZONE = 'Asia/Manila';

export interface CalendarDate {
  /** Full year. */
  y: number;
  /** Month, 0-based — the same convention `Date.getMonth()` uses. */
  m: number;
  /** Day of month, 1-based. */
  d: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Build the storage key from calendar parts, without going near a timezone. */
export function dateKey({ y, m, d }: CalendarDate): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/**
 * Today, in the app's timezone.
 *
 * Deliberately not `new Date().toISOString().slice(0, 10)`: that is the date at
 * UTC, which in a +8 zone is still *yesterday* until 08:00 local. A chip that
 * said "expires today" would then store yesterday's date.
 */
export function todayKey(): string {
  const now = moment.tz(APP_TIMEZONE);
  return dateKey({ y: now.year(), m: now.month(), d: now.date() });
}

/** Today plus `days`, still in the app's timezone. */
export function addDaysKey(days: number): string {
  const d = moment.tz(APP_TIMEZONE).add(days, 'days');
  return dateKey({ y: d.year(), m: d.month(), d: d.date() });
}

/**
 * Read a stored key back into calendar parts. Returns null for anything that is
 * not a well-formed key, so callers can fall back rather than render NaN.
 */
export function parseDateKey(key: string | null | undefined): CalendarDate | null {
  if (!key) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  // Reject impossible days (2026-02-31) rather than letting them roll forward.
  const probe = new Date(y, m, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m || probe.getDate() !== d) return null;
  return { y, m, d };
}
