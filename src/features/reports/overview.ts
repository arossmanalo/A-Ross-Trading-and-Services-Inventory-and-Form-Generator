import type { BillingStatementListItem } from '@/features/billing-statements/billing-statement-types';
import type { DeliveryListItem } from '@/features/deliveries/delivery-types';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import type { QuotationListItem } from '@/features/quotations/quotation-types';
import type { ServiceReportListItem } from '@/features/service-reports/service-report-types';

export type OpenDraftKind = 'service_report' | 'quotation' | 'delivery' | 'billing_statement';

export type OpenDraft = {
  kind: OpenDraftKind;
  id: string;
  customerName: string;
  businessDate: string;
  totalCentavos: number;
};

export type StockWatchItem = Pick<InventoryItemSummary, 'id' | 'name' | 'unitLabel' | 'currentStock' | 'lowStockThreshold'> & {
  low: boolean;
};

export type StatementAwaitingPayment = {
  id: string;
  bsNumber: string;
  customerName: string;
  businessDate: string;
  totalCentavos: number;
};

export type OverviewLists = {
  drafts: OpenDraft[];
  stockWatch: StockWatchItem[];
  awaitingPayment: StatementAwaitingPayment[];
};

type OverviewSources = {
  serviceReports: readonly ServiceReportListItem[];
  quotations: readonly QuotationListItem[];
  deliveries: readonly DeliveryListItem[];
  statements: readonly BillingStatementListItem[];
  items: readonly InventoryItemSummary[];
};

const byNewestDate = (a: { businessDate: string }, b: { businessDate: string }) => b.businessDate.localeCompare(a.businessDate);

/**
 * What the Overview lists: every unfinished draft, active items ordered by how
 * close they are to their low-stock level (low means at or below it, the same
 * rule as the low-stock count), and finalized statements that have no active
 * payment recorded yet.
 */
export function buildOverviewLists(sources: OverviewSources): OverviewLists {
  const drafts: OpenDraft[] = [
    ...sources.serviceReports
      .filter((report) => report.documentState === 'draft')
      .map((report) => ({ kind: 'service_report' as const, id: report.id, customerName: report.customerName, businessDate: report.businessDate, totalCentavos: report.totalBillCentavos })),
    ...sources.quotations
      .filter((quotation) => quotation.documentState === 'draft')
      .map((quotation) => ({ kind: 'quotation' as const, id: quotation.id, customerName: quotation.customerName, businessDate: quotation.businessDate, totalCentavos: quotation.totalCentavos })),
    ...sources.deliveries
      .filter((delivery) => delivery.documentState === 'draft')
      .map((delivery) => ({ kind: 'delivery' as const, id: delivery.id, customerName: delivery.customerName, businessDate: delivery.businessDate, totalCentavos: delivery.totalCentavos })),
    ...sources.statements
      .filter((statement) => statement.documentState === 'draft')
      .map((statement) => ({ kind: 'billing_statement' as const, id: statement.id, customerName: statement.customerName, businessDate: statement.businessDate, totalCentavos: statement.discountedTotalCentavos })),
  ].sort(byNewestDate);

  const headroom = (item: StockWatchItem) => item.currentStock - item.lowStockThreshold;
  const stockWatch = sources.items
    .filter((item) => item.active)
    .map(({ id, name, unitLabel, currentStock, lowStockThreshold }) => ({
      id,
      name,
      unitLabel,
      currentStock,
      lowStockThreshold,
      low: currentStock <= lowStockThreshold,
    }))
    .sort((a, b) => headroom(a) - headroom(b) || a.name.localeCompare(b.name));

  const awaitingPayment = sources.statements
    .filter((statement) => statement.documentState === 'finalized' && statement.bsNumber !== null)
    .filter((statement) => !statement.payments.some((payment) => payment.state === 'active'))
    .map((statement) => ({
      id: statement.id,
      bsNumber: statement.bsNumber ?? '',
      customerName: statement.customerName,
      businessDate: statement.businessDate,
      totalCentavos: statement.discountedTotalCentavos,
    }))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate));

  return { drafts, stockWatch, awaitingPayment };
}
