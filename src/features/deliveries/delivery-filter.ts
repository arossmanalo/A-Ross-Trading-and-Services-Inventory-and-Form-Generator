import { PERIOD_OPTIONS, isInDateRange, resolveDateRange, type PeriodFilter } from '@/domain/date-range';
import type { DeliveryListItem, DeliveryState } from '@/features/deliveries/delivery-types';

export type DeliveryBillingFilter = 'any' | 'with' | 'without';
export type DeliverySort = 'newest' | 'oldest' | 'number' | 'customer';

export type DeliveryCriteria = {
  query: string;
  state: 'all' | DeliveryState;
  billing: DeliveryBillingFilter;
  period: PeriodFilter;
  /** Custom range bounds (YYYY-MM-DD), used only when period is 'custom'. */
  from: string;
  to: string;
  sort: DeliverySort;
};

export const DEFAULT_DELIVERY_CRITERIA: DeliveryCriteria = {
  query: '',
  state: 'all',
  billing: 'any',
  period: 'all',
  from: '',
  to: '',
  sort: 'newest',
};

export { PERIOD_OPTIONS };

export const DELIVERY_STATE_OPTIONS: Array<{ value: DeliveryCriteria['state']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'voided', label: 'Voided' },
];

export const DELIVERY_BILLING_OPTIONS: Array<{ value: DeliveryBillingFilter; label: string }> = [
  { value: 'any', label: 'Any billing' },
  { value: 'with', label: 'Has a billing statement' },
  { value: 'without', label: 'No billing statement yet' },
];

export const DELIVERY_SORT_OPTIONS: Array<{ value: DeliverySort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'number', label: 'DF number (high to low)' },
  { value: 'customer', label: 'Customer A–Z' },
];

export function hasActiveDeliveryFilters(criteria: DeliveryCriteria): boolean {
  return criteria.query.trim() !== '' || criteria.state !== 'all' || criteria.billing !== 'any' || criteria.period !== 'all';
}

/** Every word typed must appear in the delivery's searchable text (number, customer, date, items, amount). */
export function filterDeliveries(items: readonly DeliveryListItem[], criteria: DeliveryCriteria, today: string): DeliveryListItem[] {
  const words = criteria.query.toLowerCase().split(/\s+/).filter(Boolean);
  const range = resolveDateRange(criteria.period, criteria.from, criteria.to, today);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (criteria.state !== 'all' && item.documentState !== criteria.state) return false;
      if (criteria.billing === 'with' && !item.linkedStatements.length) return false;
      if (criteria.billing === 'without' && item.linkedStatements.length) return false;
      if (!isInDateRange(item.businessDate, range)) return false;
      return words.every((word) => item.searchText.includes(word));
    });

  const byNumber = (item: DeliveryListItem) => (item.dfNumber ? Number(item.dfNumber.replace(/\D/g, '')) : Number.POSITIVE_INFINITY);
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

/** Value of the delivered items on the listed deliveries. Voided deliveries are left out. */
export function sumDeliveryValue(items: readonly DeliveryListItem[]): { totalCentavos: number; count: number } {
  let totalCentavos = 0;
  let count = 0;
  for (const item of items) {
    if (item.documentState === 'voided') continue;
    totalCentavos += item.totalCentavos;
    count += 1;
  }
  return { totalCentavos, count };
}
