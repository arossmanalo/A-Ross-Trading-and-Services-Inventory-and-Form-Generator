import { mkdirSync, writeFileSync } from 'node:fs';

import { buildBillingStatementHtml, type BillingStatementRenderSnapshot } from '../src/features/billing-statements/billing-statement-template.ts';

const snapshot: BillingStatementRenderSnapshot = {
  bsNumber: 'BS-000042',
  businessDate: '2026-08-31',
  fingerprint: '7B2F910ACD44',
  business: {
    name: 'A Ross Trading And Services',
    address: 'Pagasa Street\nPahinga Norte\nCandelaria, Quezon',
    contactDetails: 'arosstradingandservices@gmail.com · (0917) 5794065 · (0920) 2970054',
  },
  customer: { name: 'C & C Laundry', address: 'Lucban, Sariaya, Quezon' },
  serviceReportNumber: 'CSR-000031',
  lines: Array.from({ length: 34 }, (_, index) => ({
    description: index % 3 === 0 ? `Liquid Detergent — delivery batch ${index + 1}` : index % 3 === 1 ? `Preventive maintenance service ${index + 1}` : `Replacement component ${index + 1}`,
    quantity: index % 4 + 1,
    unitLabel: index % 3 === 1 ? 'service' : 'pc',
    unitPriceCentavos: 12500 + index * 1500,
    amountCentavos: (index % 4 + 1) * (12500 + index * 1500),
  })),
  subtotalCentavos: 3541000,
  discountLabel: 'Discount (5%)',
  discountCentavos: 177050,
  totalCentavos: 3363950,
  paymentsReceivedCentavos: 500000,
  balanceDueCentavos: 2863950,
  vatDisplayMode: 'disabled',
  vatRateBasisPoints: 0,
};

mkdirSync('tmp/pdfs', { recursive: true });
writeFileSync('tmp/pdfs/billing-fixture.html', buildBillingStatementHtml(snapshot), 'utf8');
