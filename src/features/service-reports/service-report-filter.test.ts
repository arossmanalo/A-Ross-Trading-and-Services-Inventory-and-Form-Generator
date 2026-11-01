import { describe, expect, it } from 'vitest';

import { DEFAULT_CRITERIA, filterServiceReports, hasActiveFilters, periodStart } from './service-report-filter';
import type { ServiceReportListItem } from './service-report-types';

const TODAY = '2026-09-15';

function report(id: string, extra: Partial<ServiceReportListItem> = {}): ServiceReportListItem {
  return {
    id,
    csrNumber: null,
    customerName: 'Laundry',
    equipmentName: 'Washer',
    documentState: 'finalized',
    serviceOutcome: 'completed',
    businessDate: '2026-09-10',
    pdfState: 'ready',
    linkedStatements: [],
    searchText: '',
    ...extra,
  };
}

const ITEMS: ServiceReportListItem[] = [
  report('a', { csrNumber: 'CSR-000010', customerName: 'C & C Laundry', businessDate: '2026-09-14', searchText: 'csr-000010 c & c laundry washer sn-123 bs-000004 leaking drain', linkedStatements: [{ id: 's1', bsNumber: 'BS-000004', documentState: 'finalized', totalCentavos: 1 }] }),
  report('b', { csrNumber: 'CSR-000011', customerName: 'Blue Wash', serviceOutcome: 'waiting_for_parts', businessDate: '2026-08-01', searchText: 'csr-000011 blue wash dryer motor noise' }),
  report('c', { customerName: 'Aqua Care', documentState: 'draft', serviceOutcome: 'incomplete', businessDate: '2026-09-15', searchText: 'draft aqua care ironer' }),
  report('d', { csrNumber: 'CSR-000009', customerName: 'Blue Wash', documentState: 'voided', businessDate: '2026-07-20', searchText: 'csr-000009 blue wash press', linkedStatements: [{ id: 's2', bsNumber: 'BS-000002', documentState: 'voided', totalCentavos: 1 }] }),
];

const ids = (criteria: Partial<typeof DEFAULT_CRITERIA>) => filterServiceReports(ITEMS, { ...DEFAULT_CRITERIA, ...criteria }, TODAY).map((item) => item.id);

describe('CSR list filtering', () => {
  it('returns everything, newest first, by default', () => {
    expect(ids({})).toEqual(['c', 'a', 'b', 'd']);
  });

  it('searches by code, customer, machine, linked statement and notes; every word must match', () => {
    expect(ids({ query: 'csr-000011' })).toEqual(['b']);
    expect(ids({ query: 'BLUE wash' })).toEqual(['b', 'd']);
    expect(ids({ query: 'sn-123' })).toEqual(['a']);
    expect(ids({ query: 'bs-000004' })).toEqual(['a']);
    expect(ids({ query: 'blue press' })).toEqual(['d']);
    expect(ids({ query: 'blue nothing' })).toEqual([]);
  });

  it('filters by status, outcome and billing', () => {
    expect(ids({ state: 'draft' })).toEqual(['c']);
    expect(ids({ state: 'voided' })).toEqual(['d']);
    expect(ids({ outcome: 'waiting_for_parts' })).toEqual(['b']);
    expect(ids({ billing: 'with' })).toEqual(['a']);
    // A voided statement does not count as billed.
    expect(ids({ billing: 'without' })).toEqual(['c', 'b', 'd']);
  });

  it('filters by date period using business dates', () => {
    expect(ids({ period: 'today' })).toEqual(['c']);
    expect(ids({ period: 'last7' })).toEqual(['c', 'a']);
    expect(ids({ period: 'last30' })).toEqual(['c', 'a']);
    expect(ids({ period: 'month' })).toEqual(['c', 'a']);
    expect(periodStart('last7', TODAY)).toBe('2026-09-09');
    expect(periodStart('last30', TODAY)).toBe('2026-08-17');
    expect(periodStart('month', TODAY)).toBe('2026-09-01');
    expect(periodStart('all', TODAY)).toBeNull();
  });

  it('combines filters and sorts', () => {
    expect(ids({ query: 'blue', state: 'finalized' })).toEqual(['b']);
    expect(ids({ sort: 'oldest' })).toEqual(['d', 'b', 'a', 'c']);
    expect(ids({ sort: 'number' })).toEqual(['c', 'b', 'a', 'd']);
    expect(ids({ sort: 'customer' })).toEqual(['c', 'b', 'd', 'a']);
  });

  it('knows when a filter is active', () => {
    expect(hasActiveFilters(DEFAULT_CRITERIA)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CRITERIA, query: ' x ' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_CRITERIA, sort: 'oldest' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CRITERIA, billing: 'without' })).toBe(true);
  });
});
