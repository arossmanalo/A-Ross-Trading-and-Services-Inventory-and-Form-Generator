import { describe, expect, it } from 'vitest';

import { calculateServiceReportTotal } from './service-report-total';

describe('service report totals', () => {
  it('adds billable item amounts and service rates', () => {
    expect(calculateServiceReportTotal([
      { quantity: 2, billable: true, resolvedSellingPriceCentavos: 12500 },
      { quantity: 1, billable: false, resolvedSellingPriceCentavos: null },
    ], [{ resolvedRateCentavos: 50000 }])).toBe(75000);
  });

  it('multiplies only service rates by the machine count', () => {
    expect(calculateServiceReportTotal([
      { quantity: 2, billable: true, resolvedSellingPriceCentavos: 12500 },
    ], [{ resolvedRateCentavos: 50000 }, { resolvedRateCentavos: 20000 }], 3)).toBe(25000 + 3 * 70000);
  });

  it('requires at least one machine', () => {
    expect(() => calculateServiceReportTotal([], [], 0)).toThrow(/at least one machine/);
  });

  it('excludes non-billable and unresolved item prices', () => {
    expect(calculateServiceReportTotal([
      { quantity: 3, billable: false, resolvedSellingPriceCentavos: 10000 },
      { quantity: 1, billable: true, resolvedSellingPriceCentavos: null },
    ], [])).toBe(0);
  });
});
