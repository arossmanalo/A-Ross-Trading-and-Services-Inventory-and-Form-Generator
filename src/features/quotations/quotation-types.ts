export type QuotationState = 'draft' | 'finalized' | 'voided';
export type QuotationDiscountType = 'fixed' | 'percentage' | null;
export type QuotationLineType = 'item' | 'service';
export type QuotationPriceSource = 'base' | 'customer' | 'override' | 'catalog';
export type QuotationConvertedKind = 'repair' | 'delivery';

export type QuotationSummary = {
  id: string;
  /** Null while the quotation is still an unnumbered draft. */
  qtNumber: string | null;
  customerName: string;
  documentState: QuotationState;
  businessDate: string;
  validUntil: string;
  totalCentavos: number;
  pdfState: 'not_generated' | 'pending' | 'ready' | 'error';
  /** What the quotation was converted into, once it has been. */
  convertedKind: QuotationConvertedKind | null;
};

/** A quotation as listed, with the lower-cased text the list search matches against. */
export type QuotationListItem = QuotationSummary & { searchText: string };

export type QuotationLine = {
  id: string;
  lineType: QuotationLineType;
  itemId: string | null;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPriceCentavos: number;
  amountCentavos: number;
  priceSource: QuotationPriceSource;
  overrideReason: string | null;
};

export type QuotationDetail = QuotationSummary & {
  customerId: string;
  customerAddress: string;
  subtotalCentavos: number;
  discountType: QuotationDiscountType;
  discountValue: number;
  signatureStatus: string;
  hasSignedVersion: boolean;
  shareState: 'not_shared' | 'shared';
  finalizedAt: string | null;
  convertedServiceReportId: string | null;
  convertedDeliveryId: string | null;
  convertedBillingStatementId: string | null;
  lines: QuotationLine[];
};
