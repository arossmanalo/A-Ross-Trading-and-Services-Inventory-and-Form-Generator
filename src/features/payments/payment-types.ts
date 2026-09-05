export type PaymentMethod = 'cash' | 'bank_transfer' | 'e_wallet' | 'check' | 'other';
export type PaymentKind = 'paid_in_full' | 'down_payment' | 'balance_payment' | 'later_full';
export type PaymentState = 'active' | 'voided';

export type PaymentEntryInput = {
  idempotencyKey?: string;
  amountCentavos: number;
  businessDate: string;
  backdateReason?: string;
  method: PaymentMethod;
  referenceNumber?: string;
  note?: string;
};

export type InitialPaymentSelection = {
  choice: 'paid_in_full' | 'down_payment' | 'pay_later';
  payment?: PaymentEntryInput;
};

export type PaymentSummary = {
  id: string;
  paNumber: string;
  billingStatementId: string;
  billingStatementNumber: string;
  customerName: string;
  amountCentavos: number;
  businessDate: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  note: string | null;
  paymentKind: PaymentKind;
  state: PaymentState;
  voidReason: string | null;
  pdfState: 'not_generated' | 'pending' | 'ready' | 'error';
  shareState: 'not_shared' | 'shared';
};

export type StatementPaymentStatus = {
  totalCentavos: number;
  activePaidCentavos: number;
  balanceCentavos: number;
  status: 'unpaid' | 'balance_due' | 'paid';
  payments: PaymentSummary[];
};
