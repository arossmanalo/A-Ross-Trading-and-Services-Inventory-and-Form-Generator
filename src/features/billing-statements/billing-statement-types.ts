export type BillingDocumentState = 'draft' | 'finalized' | 'voided';
export type BillingLineType = 'item' | 'service' | 'expense';
export type BillingPriceSource = 'base' | 'customer' | 'override' | 'catalog' | 'ad_hoc' | 'expense';
export type BillingDiscountType = 'fixed' | 'percentage' | null;

export type BillingStatementSummary = {
  id: string;
  bsNumber: string | null;
  customerName: string;
  documentState: BillingDocumentState;
  businessDate: string;
  discountedTotalCentavos: number;
  pdfState: 'not_generated' | 'pending' | 'ready' | 'error';
};

export type BillingStatementLine = {
  id: string;
  lineType: BillingLineType;
  sourceCsrUsageId: string | null;
  itemId: string | null;
  serviceId: string | null;
  expenseId: string | null;
  description: string;
  quantity: number;
  unitPriceCentavos: number;
  amountCentavos: number;
  priceSource: BillingPriceSource | null;
  overrideReason: string | null;
};

export type BillingExpense = {
  id: string;
  description: string;
  actualCostCentavos: number;
  billable: boolean;
  billedAmountCentavos: number | null;
};

export type BillingStatementDetail = BillingStatementSummary & {
  customerId: string;
  customerAddress: string;
  serviceReportId: string | null;
  serviceReportNumber: string | null;
  backdateReason: string | null;
  subtotalCentavos: number;
  discountType: BillingDiscountType;
  discountValue: number;
  paymentChoice: 'paid_in_full' | 'down_payment' | 'pay_later' | null;
  shareState: 'not_shared' | 'shared';
  finalizedAt: string | null;
  lines: BillingStatementLine[];
  expenses: BillingExpense[];
};

export type EligibleCsrUsage = {
  id: string;
  csrNumber: string;
  itemName: string;
  quantity: number;
  unitLabel: string;
  unitPriceCentavos: number;
  amountCentavos: number;
};
