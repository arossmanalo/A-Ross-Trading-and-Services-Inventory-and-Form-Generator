import { PERIOD_OPTIONS, isInDateRange, periodStart, resolveDateRange, type PeriodFilter } from '@/domain/date-range';
import type { DocumentState, ServiceOutcome, ServiceReportListItem } from '@/features/service-reports/service-report-types';

export type BillingFilter = 'any' | 'with' | 'without';
export { PERIOD_OPTIONS, periodStart };
export type { PeriodFilter };
export type ReportSort = 'newest' | 'oldest' | 'number' | 'customer';

export type ServiceReportCriteria = {
  query: string;
  state: 'all' | DocumentState;
  outcome: 'all' | ServiceOutcome;
  billing: BillingFilter;
  period: PeriodFilter;
  /** Custom range bounds (YYYY-MM-DD), used only when period is 'custom'. */
  from: string;
  to: string;
  sort: ReportSort;
};

export const DEFAULT_CRITERIA: ServiceReportCriteria = {
  query: '',
  state: 'all',
  outcome: 'all',
  billing: 'any',
  period: 'all',
  from: '',
  to: '',
  sort: 'newest',
};

export const STATE_OPTIONS: Array<{ value: ServiceReportCriteria['state']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'voided', label: 'Voided' },
];

export const OUTCOME_OPTIONS: Array<{ value: ServiceReportCriteria['outcome']; label: string }> = [
  { value: 'all', label: 'All outcomes' },
  { value: 'completed', label: 'Completed' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'waiting_for_parts', label: 'Waiting for parts' },
  { value: 'under_observation', label: 'Under observation' },
];

export const BILLING_OPTIONS: Array<{ value: BillingFilter; label: string }> = [
  { value: 'any', label: 'Any billing' },
  { value: 'with', label: 'Has a billing statement' },
  { value: 'without', label: 'No billing statement yet' },
];

export const SORT_OPTIONS: Array<{ value: ReportSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'number', label: 'CSR number (high to low)' },
  { value: 'customer', label: 'Customer A–Z' },
];

export function hasActiveFilters(criteria: ServiceReportCriteria): boolean {
  return criteria.query.trim() !== '' || criteria.state !== 'all' || criteria.outcome !== 'all' || criteria.billing !== 'any' || criteria.period !== 'all';
}

/**
 * Filters and sorts the CSR list. Every word typed must appear somewhere in the
 * CSR's searchable text (number, customer, machines, linked statements, notes…).
 */
export function filterServiceReports(items: readonly ServiceReportListItem[], criteria: ServiceReportCriteria, today: string): ServiceReportListItem[] {
  const words = criteria.query.toLowerCase().split(/\s+/).filter(Boolean);
  const range = resolveDateRange(criteria.period, criteria.from, criteria.to, today);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (criteria.state !== 'all' && item.documentState !== criteria.state) return false;
      if (criteria.outcome !== 'all' && item.serviceOutcome !== criteria.outcome) return false;
      const billed = item.linkedStatements.some((statement) => statement.documentState !== 'voided');
      if (criteria.billing === 'with' && !billed) return false;
      if (criteria.billing === 'without' && billed) return false;
      if (!isInDateRange(item.businessDate, range)) return false;
      return words.every((word) => item.searchText.includes(word));
    });

  const byNumber = (item: ServiceReportListItem) => (item.csrNumber ? Number(item.csrNumber.replace(/\D/g, '')) : Number.POSITIVE_INFINITY);
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

/** Sum of the listed CSR totals. Voided CSRs are not sales and are left out. */
export function sumServiceReportSales(items: readonly ServiceReportListItem[]): { totalCentavos: number; count: number } {
  let totalCentavos = 0;
  let count = 0;
  for (const item of items) {
    if (item.documentState === 'voided') continue;
    totalCentavos += item.totalBillCentavos;
    count += 1;
  }
  return { totalCentavos, count };
}
