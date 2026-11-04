export type PeriodFilter = 'all' | 'today' | 'last7' | 'last30' | 'month' | 'custom';

export const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

/** Earliest business date (YYYY-MM-DD, inclusive) a preset period allows, or null for no limit. */
export function periodStart(period: PeriodFilter, today: string): string | null {
  if (period === 'all' || period === 'custom') return null;
  if (period === 'today') return today;
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  const days = period === 'last7' ? 6 : 29;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Inclusive start and end dates for a period; null means unbounded on that side.
 * Presets end today. A custom range uses the chosen dates and, if they were
 * picked the wrong way round, swaps them.
 */
export function resolveDateRange(period: PeriodFilter, customFrom: string, customTo: string, today: string): { start: string | null; end: string | null } {
  if (period === 'custom') {
    const from = customFrom || null;
    const to = customTo || null;
    if (from && to && from > to) return { start: to, end: from };
    return { start: from, end: to };
  }
  const start = periodStart(period, today);
  return { start, end: start ? today : null };
}

export function isInDateRange(date: string, range: { start: string | null; end: string | null }): boolean {
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}
