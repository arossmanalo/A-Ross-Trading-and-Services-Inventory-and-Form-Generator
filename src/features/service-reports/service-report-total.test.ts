import { describe, expect, it } from 'vitest';

import { calculateServiceReportTotal } from './service-report-total';

describe('service report totals', () => {
  it('adds billable item amounts and service rates', () => {
    expect(calculateServiceReportTotal([
      { quantity: 2, billable: true, resolvedSellingPriceCentavos: 12500 },
      { quantity: 1, billable: false, resolvedSellingPriceCentavos: null },
    ], [{ resolvedRateCentavos: 50000 }])).toBe(75000);
  });

  it('adds every per-machine service price as entered', () => {
    expect(calculateServiceReportTotal([
      { quantity: 2, billable: true, resolvedSellingPriceCentavos: 12500 },
    ], [
      { resolvedRateCentavos: 200000 },
      { resolvedRateCentavos: 200000 },
      { resolvedRateCentavos: 100000 },
      { resolvedRateCentavos: 400000 },
      { resolvedRateCentavos: 400000 },
    ])).toBe(25000 + 1300000);
  });

  it('excludes non-billable and unresolved item prices', () => {
    expect(calculateServiceReportTotal([
      { quantity: 3, billable: false, resolvedSellingPriceCentavos: 10000 },
      { quantity: 1, billable: true, resolvedSellingPriceCentavos: null },
    ], [])).toBe(0);
  });
});
