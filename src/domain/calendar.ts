const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export type CalendarDate = { year: number; month: number; day: number };

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses a strict YYYY-MM-DD date; impossible dates such as 2026-02-30 return null. */
export function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Readable form such as "September 5, 2026"; unparseable text is shown as typed. */
export function formatDisplayDate(value: string): string {
  const date = parseIsoDate(value);
  return date ? `${monthName(date.month)} ${date.day}, ${date.year}` : value;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Weeks (Sunday first) of day numbers for a month; leading and trailing blanks are null. */
export function buildMonthGrid(year: number, month: number): Array<Array<number | null>> {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: Array<number | null> = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** True when `value` is within the optional inclusive bounds. ISO dates compare as text. */
export function isDateAllowed(value: string, bounds: { min?: string; max?: string } = {}): boolean {
  if (bounds.min && value < bounds.min) return false;
  if (bounds.max && value > bounds.max) return false;
  return true;
}
