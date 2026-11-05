import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

import { buildBillingStatementHtml, type BillingStatementRenderSnapshot } from './billing-statement-template';

const snapshot: BillingStatementRenderSnapshot = {
  bsNumber: 'BS-000001', businessDate: '2026-09-01', fingerprint: 'ABC123DEF456',
  business: { name: 'A.Ross', address: 'Addr', contactDetails: '0917' },
  customer: { name: 'Quicklean', address: 'Somewhere' }, serviceReportNumber: 'CSR-000002',
  lines: [{ description: 'Filter', quantity: 2, unitLabel: 'pc', unitPriceCentavos: 12500, amountCentavos: 25000 }],
  subtotalCentavos: 25000, discountLabel: 'Discount', discountCentavos: 1000, totalCentavos: 24000,
  paymentsReceivedCentavos: 5000, balanceDueCentavos: 19000, vatDisplayMode: 'inclusive', vatRateBasisPoints: 1200,
};

// The Quotation shares this template's styles; this guards the Billing Statement's output against drift.
it('renders the Billing Statement exactly as before the form styles were shared', () => {
  const hash = createHash('sha256').update(buildBillingStatementHtml(snapshot)).digest('hex');
  expect(hash).toBe('defe04cc26cb1ccc412785c7dd861e47fc50edc526e22ccee0a91b61b01c77e2');
});
