import { describe, expect, it } from 'vitest';

import {
  calculateDiscountCentavos,
  calculateDiscountedTotalCentavos,
  parseCurrencyToCentavos,
} from './money';

describe('money', () => {
  it('parses PHP input without floating-point arithmetic', () => {
    expect(parseCurrencyToCentavos('₱1,200.50')).toBe(120_050);
    expect(parseCurrencyToCentavos('975')).toBe(97_500);
  });

  it('rejects fractions smaller than a centavo', () => {
    expect(() => parseCurrencyToCentavos('10.005')).toThrow(/at most two decimal places/i);
  });

  it('applies a percentage discount once to the subtotal', () => {
    expect(
      calculateDiscountedTotalCentavos([840_000, 487_500], {
        type: 'percentage',
        basisPoints: 500,
      }),
    ).toBe(1_261_125);
  });

  it('blocks fixed discounts above the subtotal', () => {
    expect(() =>
      calculateDiscountCentavos(10_000, { type: 'fixed', valueCentavos: 10_001 }),
    ).toThrow(/cannot exceed/i);
  });
});
