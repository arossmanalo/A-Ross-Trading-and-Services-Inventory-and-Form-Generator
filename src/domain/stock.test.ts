import { describe, expect, it } from 'vitest';

import { assertPositiveIntegerQuantity, calculateStockAfterMovement } from './stock';

describe('stock', () => {
  it('allows whole-number restock and consumption', () => {
    expect(calculateStockAfterMovement(4, 3)).toBe(7);
    expect(calculateStockAfterMovement(7, -2)).toBe(5);
  });

  it('blocks stock from becoming negative', () => {
    expect(() => calculateStockAfterMovement(2, -3)).toThrow(/insufficient stock/i);
  });

  it('rejects fractional quantities', () => {
    expect(() => assertPositiveIntegerQuantity(1.5)).toThrow(/whole number/i);
  });
});
