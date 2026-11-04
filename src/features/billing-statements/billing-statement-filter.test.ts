import { describe, expect, it } from 'vitest';

import { resolveDateRange } from '@/domain/date-range';
import { DEFAULT_CRITERIA, filterServiceReports, sumServiceReportSales } from '@/features/service-reports/service-report-filter';
import type { ServiceReportListItem } from '@/features/service-reports/service-report-types';

import {
  DEFAULT_STATEMENT_CRITERIA,
  filterBillingStatements,
  hasActiveStatementFilters,
  sumStatementSales,
} from './billing-statement-filter';
import type { BillingStatementListItem } from './billing-statement-types';

const TODAY = '2026-11-05';

function statement(id: string, extra: Partial<BillingStatementListItem> = {}): BillingStatementListItem {
  return {
    id,
    bsNumber: null,
    customerName: 'Quicklean',
    serviceReportId: null,
    serviceReportNumber: null,
    documentState: 'finalized',
    businessDate: '2026-11-01',
    discountedTotalCentavos: 100000,
    pdfState: 'ready',
    payments: [],
    searchText: '',
    ...extra,
  };
}

const STATEMENTS: BillingStatementListItem[] = [
  statement('a', { bsNumber: 'BS-000018', serviceReportId: 'c1', serviceReportNumber: 'CSR-000028', businessDate: '2026-11-03', discountedTotalCentavos: 100000, payments: [{ id: 'p1', paNumber: 'PA-000004', state: 'active' }], searchText: 'bs-000018 quicklean csr-000028 pa-000004 1000.00' }),
  statement('b', { bsNumber: 'BS-000012', customerName: 'Blue Wash', businessDate: '2026-10-26', discountedTotalCentavos: 4770000, searchText: 'bs-000012 blue wash' }),
  statement('c', { bsNumber: 'BS-000011', documentState: 'voided', businessDate: '2026-10-20', discountedTotalCentavos: 250000, payments: [{ id: 'p2', paNumber: 'PA-000002', state: 'voided' }], searchText: 'bs-000011 quicklean pa-000002' }),
  statement('d', { documentState: 'draft', businessDate: '2026-11-05', discountedTotalCentavos: 0, searchText: 'draft quicklean' }),
];

describe('custom date range', () => {
  it('uses the chosen dates and swaps them when picked backwards', () => {
    expect(resolveDateRange('custom', '2026-10-01', '2026-10-31', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(resolveDateRange('custom', '2026-10-31', '2026-10-01', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(resolveDateRange('custom', '', '2026-10-31', TODAY)).toEqual({ start: null, end: '2026-10-31' });
    expect(resolveDateRange('all', '', '', TODAY)).toEqual({ start: null, end: null });
  });
});

describe('billing statement filters', () => {
  it('searches across numbers, customer and linked payment numbers', () => {
    const ids = (query: string) => filterBillingStatements(STATEMENTS, { ...DEFAULT_STATEMENT_CRITERIA, query }, TODAY).map((item) => item.id);
    expect(ids('pa-000004')).toEqual(['a']);
    expect(ids('quicklean')).toEqual(['d', 'a', 'c']);
    expect(ids('blue wash')).toEqual(['b']);
  });

  it('filters by status, CSR link, payment and a custom range', () => {
    const run = (extra: object) => filterBillingStatements(STATEMENTS, { ...DEFAULT_STATEMENT_CRITERIA, ...extra }, TODAY).map((item) => item.id);
    expect(run({ state: 'voided' })).toEqual(['c']);
    expect(run({ csr: 'with' })).toEqual(['a']);
    expect(run({ payment: 'with' })).toEqual(['a']);
    expect(run({ payment: 'without' })).toEqual(['d', 'b', 'c']);
    expect(run({ period: 'custom', from: '2026-10-20', to: '2026-10-31' })).toEqual(['b', 'c']);
  });

  it('totals the shown statements without voided ones', () => {
    expect(sumStatementSales(STATEMENTS)).toEqual({ totalCentavos: 4870000, count: 3 });
    expect(sumStatementSales([])).toEqual({ totalCentavos: 0, count: 0 });
  });

  it('reports when a filter is on', () => {
    expect(hasActiveStatementFilters(DEFAULT_STATEMENT_CRITERIA)).toBe(false);
    expect(hasActiveStatementFilters({ ...DEFAULT_STATEMENT_CRITERIA, period: 'custom' })).toBe(true);
  });
});

describe('CSR list sales total and custom range', () => {
  const report = (id: string, extra: Partial<ServiceReportListItem>): ServiceReportListItem => ({
    id, csrNumber: null, customerName: 'Quicklean', equipmentName: 'Dryer', documentState: 'finalized', serviceOutcome: 'completed',
    businessDate: '2026-10-26', pdfState: 'ready', totalBillCentavos: 0, linkedStatements: [], searchText: 'quicklean', ...extra,
  });
  const items = [
    report('x', { totalBillCentavos: 100000, businessDate: '2026-11-03' }),
    report('y', { totalBillCentavos: 4770000, businessDate: '2026-10-26' }),
    report('z', { totalBillCentavos: 250000, documentState: 'voided', businessDate: '2026-10-20' }),
  ];

  it('sums the matches and skips voided CSRs', () => {
    expect(sumServiceReportSales(items)).toEqual({ totalCentavos: 4870000, count: 2 });
  });

  it('applies a custom range to the CSR list', () => {
    const shown = filterServiceReports(items, { ...DEFAULT_CRITERIA, period: 'custom', from: '2026-10-25', to: '2026-10-31' }, TODAY);
    expect(shown.map((item) => item.id)).toEqual(['y']);
    expect(sumServiceReportSales(shown).totalCentavos).toBe(4770000);
  });
});
