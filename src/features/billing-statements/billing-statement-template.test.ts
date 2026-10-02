import { describe, expect, it } from 'vitest';

import { buildBillingStatementHtml, type BillingStatementRenderSnapshot } from './billing-statement-template';
import { DEFAULT_BUSINESS_LOGO_DATA_URL } from '@/features/settings/default-business-logo';
import { buildCsrHtml } from '@/features/service-reports/csr-template';
import { DOCUMENT_HEADER_CSS } from '@/features/documents/document-header';

const fixture: BillingStatementRenderSnapshot = {
  bsNumber: 'BS-000042', businessDate: '2026-08-31', fingerprint: 'ABC123DEF456',
  business: { name: 'A Ross Trading And Services', address: 'Pagasa Street\nPahinga Norte\nCandelaria, Quezon', contactDetails: 'arosstradingandservices@gmail.com' },
  customer: { name: 'C & C Laundry', address: 'Lucban sariaya, Quezon' }, serviceReportNumber: 'CSR-000031',
  lines: [{ description: 'Liquid Detergent <Premium>', quantity: 7, unitLabel: 'carboy', unitPriceCentavos: 120000, amountCentavos: 840000 }],
  subtotalCentavos: 840000, discountLabel: 'Discount (5%)', discountCentavos: 42000, totalCentavos: 798000,
  paymentsReceivedCentavos: 200000, balanceDueCentavos: 598000,
  vatDisplayMode: 'disabled', vatRateBasisPoints: 0,
};

describe('billing statement template', () => {
  it('uses exactly the CSR header with custom branding, separate contacts and email last', () => {
    const business = {...fixture.business, name:'Owner & Company', logoDataUrl:'data:image/png;base64,CUSTOM',contactDetails:'owner@example.com\n0917 123 4567\n0920 123 4567'};
    const billing=buildBillingStatementHtml({...fixture,business});
    const csr=buildCsrHtml({business,csrNumber:'CSR-1',businessDate:fixture.businessDate,fingerprint:'TEST',customer:fixture.customer,equipment:{machineType:'Washer',model:'',serialNumber:'',nicknameOrLocation:''},serviceOutcome:'completed',reportedProblem:[],diagnosis:[],actionTaken:[],recommendations:[],billing:[],customerRemarks:[],machineStatus:'',warrantyText:'',servicedBy:'',acknowledgedBy:'',totalBillCentavos:0,usages:[]});
    expect(billing.match(/<header class="header">[\s\S]*?<\/header>/)?.[0]).toBe(csr.match(/<header class="header">[\s\S]*?<\/header>/)?.[0]);
    expect(billing).toContain(DOCUMENT_HEADER_CSS);
    expect(csr).toContain(DOCUMENT_HEADER_CSS);
    expect(billing).toContain('0917 123 4567\n0920 123 4567\nowner@example.com');
    expect(billing).toContain('Owner &amp; Company');
    expect(billing).toContain('data:image/png;base64,CUSTOM');
    expect(billing).not.toContain('.business{width:250px}');
  });
  it('renders the required title, totals, traceability, and escaped content', () => {
    const html=buildBillingStatementHtml(fixture);
    expect(html).toContain('Billing Statement — Not a Tax Invoice');
    expect(html).toContain('BS-000042');
    expect(html).toContain('CSR CSR-000031');
    expect(html).toContain('₱7,980.00');
    expect(html).toContain('Payments Received');
    expect(html).toContain('₱5,980.00');
    expect(html).toContain('Liquid Detergent &lt;Premium&gt;');
    expect(html).toContain('ABC123DEF456');
    expect(html).toContain(DEFAULT_BUSINESS_LOGO_DATA_URL);
    expect(html).toContain('data-signature-image-slot="preparer"');
    expect(html).toContain('data-signature-image-slot="customer"');
    expect(html).not.toContain('<div class="signature-line"></div>');
    expect(html).not.toContain('break-before:page');
  });

  it('keeps long charge tables paginable with repeated headings', () => {
    const lines = Array.from({ length: 180 }, (_, index) => ({
      description: `Service line ${index}`,
      quantity: 1,
      unitLabel: 'service',
      unitPriceCentavos: 100,
      amountCentavos: 100,
    }));
    const html = buildBillingStatementHtml({ ...fixture, lines, subtotalCentavos: 18000, totalCentavos: 18000 });
    expect(html).toContain('thead{display:table-header-group}');
    expect(html.match(/<tr>/g)?.length).toBe(181);
    expect(html).toContain('Service line 179');
  });
});
