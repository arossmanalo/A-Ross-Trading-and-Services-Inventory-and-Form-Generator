export type DeliveryState = 'draft' | 'finalized' | 'voided';
export type DeliveryPriceSource = 'base' | 'customer' | 'override';

export type DeliverySummary = {
  id: string;
  /** Null while the delivery is still an unnumbered draft. */
  dfNumber: string | null;
  customerName: string;
  documentState: DeliveryState;
  businessDate: string;
  /** Value of the delivered items, which is what a linked Billing Statement bills. */
  totalCentavos: number;
  pdfState: 'not_generated' | 'pending' | 'ready' | 'error';
};

/** A delivery as listed, with the lower-cased text the list search matches against. */
export type DeliveryListItem = DeliverySummary & { searchText: string };

export type DeliveryLine = {
  id: string;
  itemId: string;
  description: string;
  unitLabel: string;
  quantity: number;
  unitPriceCentavos: number;
  amountCentavos: number;
  priceSource: DeliveryPriceSource;
  overrideReason: string | null;
  /** Stock on hand right now, so a draft can show a shortage before finalizing. */
  currentStock: number;
};

export type DeliveryDetail = DeliverySummary & {
  customerId: string;
  customerAddress: string;
  deliveredBy: string;
  receivedBy: string;
  notes: string;
  signatureStatus: string;
  hasSignedVersion: boolean;
  shareState: 'not_shared' | 'shared';
  finalizedAt: string | null;
  voidReason: string | null;
  lines: DeliveryLine[];
};

export type DeliveryDraftInput = {
  businessDate: string;
  deliveredBy: string;
  receivedBy: string;
  notes: string;
};
