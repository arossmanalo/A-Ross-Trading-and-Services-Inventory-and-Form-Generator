import { describe, expect, it } from 'vitest';

import { assertOptionalEmail, filterCustomersForSelection, normalizeCustomerName } from './customer';

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

  describe('customer selection search', () => {
    const customer = (name: string, extra: Partial<Parameters<typeof filterCustomersForSelection>[0][number]> = {}) => ({
      name, address: '', contactNumber: '', email: '', active: true, ...extra,
    });
    const customers = [
      customer('C & C Laundry', { address: 'Lucban, Quezon', contactNumber: '0917 123 4567' }),
      customer('Blue Wash', { email: 'Owner@BlueWash.example' }),
      customer('Closed Shop', { active: false }),
    ];

    it('returns every active customer for an empty search and never offers inactive ones', () => {
      expect(filterCustomersForSelection(customers, '  ').map((entry) => entry.name)).toEqual(['C & C Laundry', 'Blue Wash']);
    });

    it('matches name, address and email regardless of case or extra spaces', () => {
      expect(filterCustomersForSelection(customers, ' c  &  c ').map((entry) => entry.name)).toEqual(['C & C Laundry']);
      expect(filterCustomersForSelection(customers, 'lucban').map((entry) => entry.name)).toEqual(['C & C Laundry']);
      expect(filterCustomersForSelection(customers, 'owner@bluewash').map((entry) => entry.name)).toEqual(['Blue Wash']);
    });

    it('matches phone numbers by digits and ignores a too-short digit fragment', () => {
      expect(filterCustomersForSelection(customers, '0917-123').map((entry) => entry.name)).toEqual(['C & C Laundry']);
      expect(filterCustomersForSelection(customers, '09')).toEqual([]);
    });
  });
});
