// Codra runs in the worker's local timezone. Render all timestamps there so
// they match what the operator expects, not the viewer's browser timezone.
export const WORKER_TIME_ZONE = 'America/Los_Angeles';

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WORKER_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Format an ISO timestamp in the worker's timezone (America/Los_Angeles). */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

const numberFormatter = new Intl.NumberFormat('en-US');

/** Format a number with thousands separators (e.g. 1,234). */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return numberFormatter.format(value);
}
