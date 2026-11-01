import { describe, expect, it } from 'vitest';

import { buildMonthGrid, daysInMonth, formatDisplayDate, formatIsoDate, isDateAllowed, parseIsoDate, shiftMonth } from './calendar';

describe('calendar helpers', () => {
  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('parses strict dates and rejects impossible ones', () => {
    expect(parseIsoDate('2026-09-05')).toEqual({ year: 2026, month: 9, day: 5 });
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('09/05/2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });

  it('formats dates for storage and for display', () => {
    expect(formatIsoDate({ year: 2026, month: 9, day: 5 })).toBe('2026-09-05');
    expect(formatDisplayDate('2026-09-05')).toBe('September 5, 2026');
    expect(formatDisplayDate('not a date')).toBe('not a date');
  });

  it('moves between months across year boundaries', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 9, 12)).toEqual({ year: 2027, month: 9 });
    expect(shiftMonth(2026, 3, -15)).toEqual({ year: 2024, month: 12 });
  });

  it('builds Sunday-first weeks with blanks around the month', () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const grid = buildMonthGrid(2026, 9);
    expect(grid[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
    expect(grid.at(-1)).toEqual([27, 28, 29, 30, null, null, null]);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid.flat().filter((day) => day !== null)).toHaveLength(30);
    // February 2026 starts on a Sunday and fits exactly four weeks.
    expect(buildMonthGrid(2026, 2)).toHaveLength(4);
  });

  it('applies optional minimum and maximum dates', () => {
    expect(isDateAllowed('2026-09-05')).toBe(true);
    expect(isDateAllowed('2026-09-06', { max: '2026-09-05' })).toBe(false);
    expect(isDateAllowed('2026-09-05', { max: '2026-09-05' })).toBe(true);
    expect(isDateAllowed('2026-08-31', { min: '2026-09-01' })).toBe(false);
  });
});
