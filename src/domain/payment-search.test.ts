import { describe, expect, it } from 'vitest';

import { filterPaymentsByQuery } from './payment-search';

const payment = (paNumber: string, extra: Partial<Parameters<typeof filterPaymentsByQuery>[0][number]> = {}) => ({
  paNumber,
  billingStatementNumber: 'BS-000001',
  serviceReportNumber: null,
  customerName: 'Quicklean',
  referenceNumber: null,
  method: 'cash',
  ...extra,
});

describe('payment list search', () => {
  const payments = [
    payment('PA-000001', { customerName: 'AR Laundry Shop', serviceReportNumber: 'CSR-000042' }),
    payment('PA-000002', { billingStatementNumber: 'BS-000009', method: 'bank_transfer', referenceNumber: 'GCash 7781' }),
  ];

  it('keeps every payment for an empty search', () => {
    expect(filterPaymentsByQuery(payments, '  ')).toHaveLength(2);
  });

  it('matches PA, statement and CSR numbers, customer, reference and method', () => {
    const ids = (query: string) => filterPaymentsByQuery(payments, query).map((entry) => entry.paNumber);
    expect(ids('pa-000002')).toEqual(['PA-000002']);
    expect(ids('bs-000009')).toEqual(['PA-000002']);
    expect(ids('csr-000042')).toEqual(['PA-000001']);
    expect(ids('ar  laundry')).toEqual(['PA-000001']);
    expect(ids('gcash')).toEqual(['PA-000002']);
    expect(ids('bank transfer')).toEqual(['PA-000002']);
    expect(ids('nothing like this')).toEqual([]);
  });
});
