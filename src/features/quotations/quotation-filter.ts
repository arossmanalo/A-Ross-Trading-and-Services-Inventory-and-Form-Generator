import { PERIOD_OPTIONS, isInDateRange, resolveDateRange, type PeriodFilter } from '@/domain/date-range';
import type { QuotationListItem, QuotationState } from '@/features/quotations/quotation-types';

export type QuotationConversionFilter = 'any' | 'converted' | 'not_converted';
export type QuotationSort = 'newest' | 'oldest' | 'number' | 'customer';

export type QuotationCriteria = {
  query: string;
  state: 'all' | QuotationState;
  conversion: QuotationConversionFilter;
  period: PeriodFilter;
  /** Custom range bounds (YYYY-MM-DD), used only when period is 'custom'. */
  from: string;
  to: string;
  sort: QuotationSort;
};

export const DEFAULT_QUOTATION_CRITERIA: QuotationCriteria = {
  query: '',
  state: 'all',
  conversion: 'any',
  period: 'all',
  from: '',
  to: '',
  sort: 'newest',
};

export { PERIOD_OPTIONS };

export const QUOTATION_STATE_OPTIONS: Array<{ value: QuotationCriteria['state']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'voided', label: 'Voided' },
];

export const QUOTATION_CONVERSION_OPTIONS: Array<{ value: QuotationConversionFilter; label: string }> = [
  { value: 'any', label: 'Any conversion' },
  { value: 'converted', label: 'Converted' },
  { value: 'not_converted', label: 'Not converted yet' },
];

export const QUOTATION_SORT_OPTIONS: Array<{ value: QuotationSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'number', label: 'QT number (high to low)' },
  { value: 'customer', label: 'Customer A–Z' },
];

export function hasActiveQuotationFilters(criteria: QuotationCriteria): boolean {
  return criteria.query.trim() !== '' || criteria.state !== 'all' || criteria.conversion !== 'any' || criteria.period !== 'all';
}

/** Every word typed must appear in the quotation's searchable text (number, customer, date, items, amount). */
export function filterQuotations(items: readonly QuotationListItem[], criteria: QuotationCriteria, today: string): QuotationListItem[] {
  const words = criteria.query.toLowerCase().split(/\s+/).filter(Boolean);
  const range = resolveDateRange(criteria.period, criteria.from, criteria.to, today);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (criteria.state !== 'all' && item.documentState !== criteria.state) return false;
      if (criteria.conversion === 'converted' && !item.convertedKind) return false;
      if (criteria.conversion === 'not_converted' && item.convertedKind) return false;
      if (!isInDateRange(item.businessDate, range)) return false;
      return words.every((word) => item.searchText.includes(word));
    });

  const byNumber = (item: QuotationListItem) => (item.qtNumber ? Number(item.qtNumber.replace(/\D/g, '')) : Number.POSITIVE_INFINITY);
  matches.sort((a, b) => {
    switch (criteria.sort) {
      case 'oldest': return a.item.businessDate.localeCompare(b.item.businessDate) || b.index - a.index;
      case 'number': return byNumber(b.item) - byNumber(a.item) || a.index - b.index;
      case 'customer': return a.item.customerName.localeCompare(b.item.customerName, undefined, { sensitivity: 'base' }) || a.index - b.index;
      default: return b.item.businessDate.localeCompare(a.item.businessDate) || a.index - b.index;
    }
  });
  return matches.map(({ item }) => item);
}

/** Sum of the listed quotation totals. Voided quotations are left out. */
export function sumQuotationTotals(items: readonly QuotationListItem[]): { totalCentavos: number; count: number } {
  let totalCentavos = 0;
  let count = 0;
  for (const item of items) {
    if (item.documentState === 'voided') continue;
    totalCentavos += item.totalCentavos;
    count += 1;
  }
  return { totalCentavos, count };
}
