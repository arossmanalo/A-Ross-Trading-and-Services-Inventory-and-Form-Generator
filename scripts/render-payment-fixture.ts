import { mkdirSync, writeFileSync } from 'node:fs';

import { buildPaymentAcknowledgmentHtml, type PaymentRenderSnapshot } from '../src/features/payments/payment-template.ts';

const snapshot: PaymentRenderSnapshot = {
  paNumber: 'PA-000042',
  businessDate: '2026-09-05',
  fingerprint: 'C17A6E9D2F44',
  business: {
    name: 'A Ross Trading And Services',
    address: 'Pagasa Street\nPahinga Norte\nCandelaria, Quezon',
    contactDetails: 'arosstradingandservices@gmail.com · (0917) 5794065 · (0920) 2970054',
  },
  customer: { name: 'C & C Laundry', address: 'Lucban, Sariaya, Quezon' },
  billingStatementNumber: 'BS-000031',
  paymentKind: 'down_payment',
  amountCentavos: 500000,
  method: 'e_wallet',
  referenceNumber: 'GCASH-20260905-001',
  note: 'Initial down payment for maintenance and replacement parts.',
  statementTotalCentavos: 1327500,
  totalPaymentsAfterCentavos: 500000,
  remainingBalanceCentavos: 827500,
};

mkdirSync('tmp/pdfs', { recursive: true });
writeFileSync('tmp/pdfs/payment-fixture.html', buildPaymentAcknowledgmentHtml(snapshot), 'utf8');
