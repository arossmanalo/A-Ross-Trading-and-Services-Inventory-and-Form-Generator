import { describe, expect, it } from 'vitest';

import { DEFAULT_QUOTATION_CRITERIA, filterQuotations, hasActiveQuotationFilters, sumQuotationTotals } from './quotation-filter';
import type { QuotationListItem } from './quotation-types';

const TODAY = '2026-11-05';

function quotation(id: string, extra: Partial<QuotationListItem> = {}): QuotationListItem {
  return {
    id, qtNumber: null, customerName: 'Quicklean', documentState: 'finalized', businessDate: '2026-11-01', validUntil: '2026-12-01',
    totalCentavos: 100000, pdfState: 'ready', convertedKind: null, searchText: '', ...extra,
  };
}

const ITEMS: QuotationListItem[] = [
  quotation('a', { qtNumber: 'QT-000003', businessDate: '2026-11-03', totalCentavos: 500000, convertedKind: 'repair', searchText: 'qt-000003 quicklean washer repair' }),
  quotation('b', { qtNumber: 'QT-000002', customerName: 'Blue Wash', businessDate: '2026-10-20', totalCentavos: 250000, searchText: 'qt-000002 blue wash detergent' }),
  quotation('c', { documentState: 'voided', businessDate: '2026-10-10', totalCentavos: 90000, searchText: 'qt-000001 quicklean' }),
  quotation('d', { documentState: 'draft', businessDate: '2026-11-05', totalCentavos: 0, searchText: 'draft quicklean' }),
];

describe('quotation filters', () => {
  const ids = (extra: object) => filterQuotations(ITEMS, { ...DEFAULT_QUOTATION_CRITERIA, ...extra }, TODAY).map((item) => item.id);

  it('searches every typed word across number, customer and items', () => {
    expect(ids({ query: 'quicklean washer' })).toEqual(['a']);
    expect(ids({ query: 'detergent' })).toEqual(['b']);
  });

  it('filters by status, conversion and a custom range, and sorts', () => {
    expect(ids({ state: 'voided' })).toEqual(['c']);
    expect(ids({ conversion: 'converted' })).toEqual(['a']);
    expect(ids({ conversion: 'not_converted' })).toEqual(['d', 'b', 'c']);
    expect(ids({ period: 'custom', from: '2026-10-15', to: '2026-11-01' })).toEqual(['b']);
    expect(ids({ sort: 'number' })).toEqual(['c', 'd', 'a', 'b']); // unnumbered drafts sort first, as on the other lists
    expect(ids({ sort: 'customer' })).toEqual(['b', 'a', 'c', 'd']);
  });

  it('totals the shown quotations without voided ones', () => {
    expect(sumQuotationTotals(ITEMS)).toEqual({ totalCentavos: 750000, count: 3 });
    expect(hasActiveQuotationFilters(DEFAULT_QUOTATION_CRITERIA)).toBe(false);
    expect(hasActiveQuotationFilters({ ...DEFAULT_QUOTATION_CRITERIA, conversion: 'converted' })).toBe(true);
  });
});
