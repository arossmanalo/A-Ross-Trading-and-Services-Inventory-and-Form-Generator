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
it('renders the Billing Statement exactly as expected (template billing-a4-v8)', () => {
  const hash = createHash('sha256').update(buildBillingStatementHtml(snapshot)).digest('hex');
  expect(hash).toBe('57b100efb647ed242b3d478ee64d2f68a539f2167534717e6d9e2808e8a1d05e');
});
