import { PERIOD_OPTIONS, isInDateRange, resolveDateRange, type PeriodFilter } from '@/domain/date-range';
import type { BillingDocumentState, BillingStatementListItem } from '@/features/billing-statements/billing-statement-types';

export type StatementCsrFilter = 'any' | 'with' | 'without';
export type StatementPaymentFilter = 'any' | 'with' | 'without';
export type StatementSort = 'newest' | 'oldest' | 'number' | 'customer';

export type BillingStatementCriteria = {
  query: string;
  state: 'all' | BillingDocumentState;
  csr: StatementCsrFilter;
  payment: StatementPaymentFilter;
  period: PeriodFilter;
  /** Custom range bounds (YYYY-MM-DD), used only when period is 'custom'. */
  from: string;
  to: string;
  sort: StatementSort;
};

export const DEFAULT_STATEMENT_CRITERIA: BillingStatementCriteria = {
  query: '',
  state: 'all',
  csr: 'any',
  payment: 'any',
  period: 'all',
  from: '',
  to: '',
  sort: 'newest',
};

export { PERIOD_OPTIONS };

export const STATEMENT_STATE_OPTIONS: Array<{ value: BillingStatementCriteria['state']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'voided', label: 'Voided' },
];

export const STATEMENT_CSR_OPTIONS: Array<{ value: StatementCsrFilter; label: string }> = [
  { value: 'any', label: 'Any CSR link' },
  { value: 'with', label: 'Linked to a CSR' },
  { value: 'without', label: 'Not linked to a CSR' },
];

export const STATEMENT_PAYMENT_OPTIONS: Array<{ value: StatementPaymentFilter; label: string }> = [
  { value: 'any', label: 'Any payment' },
  { value: 'with', label: 'Has a payment acknowledgment' },
  { value: 'without', label: 'No payment acknowledgment yet' },
];

export const STATEMENT_SORT_OPTIONS: Array<{ value: StatementSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'number', label: 'BS number (high to low)' },
  { value: 'customer', label: 'Customer A–Z' },
];

export function hasActiveStatementFilters(criteria: BillingStatementCriteria): boolean {
  return criteria.query.trim() !== '' || criteria.state !== 'all' || criteria.csr !== 'any' || criteria.payment !== 'any' || criteria.period !== 'all';
}

/** Payments that still count, that is, not voided. */
export function activePayments(item: BillingStatementListItem) {
  return item.payments.filter((payment) => payment.state !== 'voided');
}

/**
 * Filters and sorts the Billing Statement list. Every word typed must appear in
 * the statement's searchable text (number, customer, date, CSR, payments, amount).
 */
export function filterBillingStatements(items: readonly BillingStatementListItem[], criteria: BillingStatementCriteria, today: string): BillingStatementListItem[] {
  const words = criteria.query.toLowerCase().split(/\s+/).filter(Boolean);
  const range = resolveDateRange(criteria.period, criteria.from, criteria.to, today);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (criteria.state !== 'all' && item.documentState !== criteria.state) return false;
      const hasCsr = item.serviceReportId !== null;
      if (criteria.csr === 'with' && !hasCsr) return false;
      if (criteria.csr === 'without' && hasCsr) return false;
      const paid = activePayments(item).length > 0;
      if (criteria.payment === 'with' && !paid) return false;
      if (criteria.payment === 'without' && paid) return false;
      if (!isInDateRange(item.businessDate, range)) return false;
      return words.every((word) => item.searchText.includes(word));
    });

  const byNumber = (item: BillingStatementListItem) => (item.bsNumber ? Number(item.bsNumber.replace(/\D/g, '')) : Number.POSITIVE_INFINITY);
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

/** Sum of the listed statement totals. Voided statements are not sales and are left out. */
export function sumStatementSales(items: readonly BillingStatementListItem[]): { totalCentavos: number; count: number } {
  let totalCentavos = 0;
  let count = 0;
  for (const item of items) {
    if (item.documentState === 'voided') continue;
    totalCentavos += item.discountedTotalCentavos;
    count += 1;
  }
  return { totalCentavos, count };
}
