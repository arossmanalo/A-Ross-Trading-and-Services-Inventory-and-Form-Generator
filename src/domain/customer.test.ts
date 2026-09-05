import { describe, expect, it } from 'vitest';

import { assertOptionalEmail, normalizeCustomerName } from './customer';

describe('customer rules', () => {
  it('normalizes surrounding and repeated whitespace for duplicate comparison', () => {
    expect(normalizeCustomerName('  C & C   Laundry  ')).toBe('C & C Laundry');
  });

  it('allows an omitted email address', () => {
    expect(() => assertOptionalEmail('')).not.toThrow();
  });

  it('rejects a malformed provided email address', () => {
    expect(() => assertOptionalEmail('customer@invalid')).toThrow(/valid email/i);
  });
});
