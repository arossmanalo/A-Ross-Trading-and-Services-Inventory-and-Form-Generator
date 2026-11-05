export type BillingDocumentState = 'draft' | 'finalized' | 'voided';
export type BillingLineType = 'item' | 'service' | 'expense';
export type BillingPriceSource = 'base' | 'customer' | 'override' | 'catalog' | 'ad_hoc' | 'expense';
export type BillingDiscountType = 'fixed' | 'percentage' | null;

export type BillingStatementSummary = {
  id: string;
  bsNumber: string | null;
  customerName: string;
  /** CSR this statement is billed against, if any. */
  serviceReportId: string | null;
  /** Null while the linked CSR is still an unnumbered draft. */
  serviceReportNumber: string | null;
  /** Delivery this statement bills, if any (never together with a CSR). */
  deliveryId: string | null;
  /** Null while the linked delivery is still an unnumbered draft. */
  deliveryNumber: string | null;
  documentState: BillingDocumentState;
  businessDate: string;
  discountedTotalCentavos: number;
  pdfState: 'not_generated' | 'pending' | 'ready' | 'error';
};

/** A Payment Acknowledgment recorded against a statement. */
export type BillingStatementLinkedPayment = {
  id: string;
  paNumber: string;
  state: 'active' | 'voided';
};

/** A statement as listed, with its payments and the lower-cased text the list search matches. */
export type BillingStatementListItem = BillingStatementSummary & {
  payments: BillingStatementLinkedPayment[];
  searchText: string;
};

export type BillingStatementLine = {
  id: string;
  /** Set when the line bills a delivery line; such lines are managed on the delivery. */
  sourceDeliveryLineId: string | null;
  lineType: BillingLineType;
  sourceCsrUsageId: string | null;
  sourceCsrServiceUsageId: string | null;
  sourceCsrMachineServiceId: string | null;
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
  subtotalCentavos: number;
  discountType: BillingDiscountType;
  discountValue: number;
  paymentChoice: 'paid_in_full' | 'down_payment' | 'pay_later' | null;
  signatureStatus: string;
  hasSignedVersion: boolean;
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
