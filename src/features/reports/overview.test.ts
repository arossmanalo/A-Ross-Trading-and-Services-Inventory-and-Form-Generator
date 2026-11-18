import { describe, expect, it } from 'vitest';

import type { BillingStatementListItem } from '@/features/billing-statements/billing-statement-types';
import type { DeliveryListItem } from '@/features/deliveries/delivery-types';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import type { QuotationListItem } from '@/features/quotations/quotation-types';
import type { ServiceReportListItem } from '@/features/service-reports/service-report-types';

import { buildOverviewLists } from './overview';

function report(id: string, documentState: ServiceReportListItem['documentState'], businessDate: string): ServiceReportListItem {
  return {
    id, csrNumber: documentState === 'draft' ? null : `CSR-${id}`, customerName: `Customer ${id}`, equipmentName: 'Washer',
    documentState, serviceOutcome: 'completed', businessDate, pdfState: 'not_generated', totalBillCentavos: 1000,
    linkedStatements: [], searchText: '',
  };
}

function statement(
  id: string,
  documentState: BillingStatementListItem['documentState'],
  payments: BillingStatementListItem['payments'],
  businessDate = '2026-11-01',
): BillingStatementListItem {
  return {
    id, bsNumber: documentState === 'draft' ? null : `BS-${id}`, customerName: `Customer ${id}`, serviceReportId: null,
    serviceReportNumber: null, deliveryId: null, deliveryNumber: null, documentState, businessDate,
    discountedTotalCentavos: 5000, pdfState: 'ready', payments, searchText: '',
  };
}

function item(id: string, currentStock: number, lowStockThreshold: number, active = true): InventoryItemSummary {
  return { id, inventoryKind: 'supply', name: `Item ${id}`, sku: null, unitLabel: 'pc', baseSellingPriceCentavos: 100, lowStockThreshold, currentStock, active };
}

const quotation: QuotationListItem = {
  id: 'q1', qtNumber: null, customerName: 'Quote customer', documentState: 'draft', businessDate: '2026-11-05',
  validUntil: '2026-12-05', totalCentavos: 2500, pdfState: 'not_generated', convertedKind: null, searchText: '',
};

const delivery: DeliveryListItem = {
  id: 'd1', dfNumber: 'DF-1', customerName: 'Delivery customer', documentState: 'finalized', businessDate: '2026-11-02',
  totalCentavos: 700, pdfState: 'ready', linkedStatements: [], searchText: '',
};

describe('overview lists', () => {
  it('lists only drafts from every document type, newest first', () => {
    const { drafts } = buildOverviewLists({
      serviceReports: [report('r1', 'draft', '2026-11-03'), report('r2', 'finalized', '2026-11-09'), report('r3', 'voided', '2026-11-09')],
      quotations: [quotation],
      deliveries: [delivery],
      statements: [statement('s1', 'draft', [], '2026-11-07')],
      items: [],
    });

    expect(drafts.map((draft) => `${draft.kind}:${draft.id}`)).toEqual([
      'billing_statement:s1',
      'quotation:q1',
      'service_report:r1',
    ]);
  });

  it('lists active items closest to their low-stock level first and flags the low ones', () => {
    const { stockWatch } = buildOverviewLists({
      serviceReports: [], quotations: [], deliveries: [], statements: [],
      items: [item('a', 2, 2), item('b', 0, 3), item('c', 5, 2), item('d', 0, 1, false)],
    });

    expect(stockWatch.map((entry) => `${entry.id}:${entry.low}`)).toEqual(['b:true', 'a:true', 'c:false']);
  });

  it('lists finalized statements that have no active payment, oldest first', () => {
    const { awaitingPayment } = buildOverviewLists({
      serviceReports: [], quotations: [], deliveries: [], items: [],
      statements: [
        statement('paid', 'finalized', [{ id: 'p1', paNumber: 'PA-1', state: 'active' }]),
        statement('voided-payment', 'finalized', [{ id: 'p2', paNumber: 'PA-2', state: 'voided' }], '2026-10-01'),
        statement('unpaid', 'finalized', [], '2026-10-20'),
        statement('void', 'voided', []),
        statement('draft', 'draft', []),
      ],
    });

    expect(awaitingPayment.map((entry) => entry.id)).toEqual(['voided-payment', 'unpaid']);
  });
});
