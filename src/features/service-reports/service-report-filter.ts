import type { DocumentState, ServiceOutcome, ServiceReportListItem } from '@/features/service-reports/service-report-types';

export type BillingFilter = 'any' | 'with' | 'without';
export type PeriodFilter = 'all' | 'today' | 'last7' | 'last30' | 'month';
export type ReportSort = 'newest' | 'oldest' | 'number' | 'customer';

export type ServiceReportCriteria = {
  query: string;
  state: 'all' | DocumentState;
  outcome: 'all' | ServiceOutcome;
  billing: BillingFilter;
  period: PeriodFilter;
  sort: ReportSort;
};

export const DEFAULT_CRITERIA: ServiceReportCriteria = {
  query: '',
  state: 'all',
  outcome: 'all',
  billing: 'any',
  period: 'all',
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

export const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
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

/** Earliest business date (YYYY-MM-DD, inclusive) a period allows, or null for no limit. */
export function periodStart(period: PeriodFilter, today: string): string | null {
  if (period === 'all') return null;
  if (period === 'today') return today;
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  const days = period === 'last7' ? 6 : 29;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Filters and sorts the CSR list. Every word typed must appear somewhere in the
 * CSR's searchable text (number, customer, machines, linked statements, notes…).
 */
export function filterServiceReports(items: readonly ServiceReportListItem[], criteria: ServiceReportCriteria, today: string): ServiceReportListItem[] {
  const words = criteria.query.toLowerCase().split(/\s+/).filter(Boolean);
  const start = periodStart(criteria.period, today);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (criteria.state !== 'all' && item.documentState !== criteria.state) return false;
      if (criteria.outcome !== 'all' && item.serviceOutcome !== criteria.outcome) return false;
      const billed = item.linkedStatements.some((statement) => statement.documentState !== 'voided');
      if (criteria.billing === 'with' && !billed) return false;
      if (criteria.billing === 'without' && billed) return false;
      if (start && (item.businessDate < start || item.businessDate > today)) return false;
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
