import { describe, expect, it } from 'vitest';

import { buildPaymentAcknowledgmentHtml, type PaymentRenderSnapshot } from './payment-template';

const fixture: PaymentRenderSnapshot = {
  paNumber:'PA-000042',businessDate:'2026-09-05',fingerprint:'ABC123DEF456',
  business:{name:'A.Ross Trading and Services',address:'Candelaria, Quezon',contactDetails:'0917'},
  customer:{name:'C & C Laundry',address:'Lucban, Quezon'},billingStatementNumber:'BS-000031',
  paymentKind:'down_payment',amountCentavos:500000,method:'e_wallet',referenceNumber:'GCASH-123',note:'Initial deposit',
  statementTotalCentavos:1327500,totalPaymentsAfterCentavos:500000,remainingBalanceCentavos:827500,
};

describe('payment acknowledgment template',()=>{it('renders the non-tax title, traceability, method, and balance',()=>{const html=buildPaymentAcknowledgmentHtml(fixture);expect(html).toContain('Payment Acknowledgment');expect(html).toContain('Not a Tax Receipt');expect(html).toContain('PA-000042');expect(html).toContain('BS-000031');expect(html).toContain('GCash / E-wallet');expect(html).toContain('₱8,275.00');expect(html).toContain('ABC123DEF456');});});
