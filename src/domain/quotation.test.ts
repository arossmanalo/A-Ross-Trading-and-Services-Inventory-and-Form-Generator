import { describe, expect, it } from 'vitest';

import { addDaysToIsoDate, defaultValidUntil, isQuotationExpired, validateValidUntil } from './quotation';

describe('quotation dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysToIsoDate('2026-09-05', 30)).toBe('2026-10-05');
    expect(addDaysToIsoDate('2026-12-20', 30)).toBe('2027-01-19');
    expect(defaultValidUntil('2026-01-31')).toBe('2026-03-02');
  });

  it('rejects malformed dates and an end date before the start', () => {
    expect(() => addDaysToIsoDate('09/05/2026', 1)).toThrow(/YYYY-MM-DD/);
    expect(() => validateValidUntil('2026-09-01', '2026-09-05')).toThrow(/expire before/);
    expect(() => validateValidUntil('2026-09-05', '2026-09-05')).not.toThrow();
  });

  it('treats a quotation as expired only after its last day', () => {
    expect(isQuotationExpired('2026-09-05', '2026-09-05')).toBe(false);
    expect(isQuotationExpired('2026-09-05', '2026-09-06')).toBe(true);
  });
});
