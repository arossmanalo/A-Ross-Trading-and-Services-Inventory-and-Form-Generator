import { describe, expect, it } from 'vitest';

import { DEFAULT_DELIVERY_CRITERIA, filterDeliveries, hasActiveDeliveryFilters, sumDeliveryValue } from './delivery-filter';
import type { DeliveryListItem } from './delivery-types';

const TODAY = '2026-11-05';

function delivery(id: string, extra: Partial<DeliveryListItem> = {}): DeliveryListItem {
  return { id, dfNumber: null, customerName: 'Quicklean', documentState: 'finalized', businessDate: '2026-11-01', totalCentavos: 100000, pdfState: 'ready', searchText: '', ...extra };
}

const ITEMS: DeliveryListItem[] = [
  delivery('a', { dfNumber: 'DF-000003', businessDate: '2026-11-03', totalCentavos: 480000, searchText: 'df-000003 quicklean detergent' }),
  delivery('b', { dfNumber: 'DF-000002', customerName: 'Blue Wash', businessDate: '2026-10-20', totalCentavos: 160000, searchText: 'df-000002 blue wash softener' }),
  delivery('c', { dfNumber: 'DF-000001', documentState: 'voided', businessDate: '2026-10-10', totalCentavos: 90000, searchText: 'df-000001 quicklean' }),
  delivery('d', { documentState: 'draft', businessDate: '2026-11-05', totalCentavos: 0, searchText: 'draft quicklean' }),
];

describe('delivery filters', () => {
  const ids = (extra: object) => filterDeliveries(ITEMS, { ...DEFAULT_DELIVERY_CRITERIA, ...extra }, TODAY).map((item) => item.id);

  it('searches, filters by status and range, and sorts', () => {
    expect(ids({ query: 'quicklean detergent' })).toEqual(['a']);
    expect(ids({ state: 'voided' })).toEqual(['c']);
    expect(ids({ period: 'custom', from: '2026-10-15', to: '2026-11-01' })).toEqual(['b']);
    expect(ids({ sort: 'number' })).toEqual(['d', 'a', 'b', 'c']);
    expect(ids({ sort: 'oldest' })).toEqual(['c', 'b', 'a', 'd']);
  });

  it('totals the delivered value without voided deliveries', () => {
    expect(sumDeliveryValue(ITEMS)).toEqual({ totalCentavos: 640000, count: 3 });
    expect(hasActiveDeliveryFilters(DEFAULT_DELIVERY_CRITERIA)).toBe(false);
    expect(hasActiveDeliveryFilters({ ...DEFAULT_DELIVERY_CRITERIA, query: 'x' })).toBe(true);
  });
});
