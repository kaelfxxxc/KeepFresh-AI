/**
 * How long ago something happened, at the resolution that matters on a
 * dashboard or in a notification list: minutes and hours for the same day, days
 * for the rest of the week, then the date itself.
 *
 * Returns an empty string for an unparseable timestamp rather than "Invalid
 * Date" — every caller renders this inline in a row of metadata, where a
 * missing value should leave a gap, not a sentence.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}
