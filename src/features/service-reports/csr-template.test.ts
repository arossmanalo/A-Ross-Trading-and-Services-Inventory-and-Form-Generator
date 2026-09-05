import { describe, expect, it } from 'vitest';

import { buildCsrHtml, escapeHtml, type CsrRenderSnapshot } from './csr-template';

const SNAPSHOT: CsrRenderSnapshot = {
  csrNumber: 'CSR-000001',
  businessDate: '2026-09-06',
  fingerprint: 'ABC123',
  business: { name: 'A.Ross Trading and Services', address: 'Quezon', contactDetails: '0912' },
  customer: { name: 'C & C Laundry', address: 'Lucban' },
  equipment: { machineType: 'Washer', model: 'M1', serialNumber: 'S1', nicknameOrLocation: '' },
  serviceOutcome: 'completed',
  reportedProblem: ['Leak'],
  diagnosis: ['Hose'],
  actionTaken: ['Replaced'],
  recommendations: [],
  billing: [],
  customerRemarks: [],
  machineStatus: 'Operational',
  warrantyText: 'Custom warranty',
  servicedBy: 'Owner',
  acknowledgedBy: 'Customer',
  totalBillCentavos: 125000,
  usages: [{ description: 'Hose', quantity: 1, unitLabel: 'pc', billable: true }],
};

describe('CSR template', () => {
  it('renders Legal-size CSS and required document sections', () => {
    const html = buildCsrHtml(SNAPSHOT);
    expect(html).toContain('@page { size: 8.5in 14in;');
    expect(html).toContain('Customer Service Report');
    expect(html).toContain('Status After Service');
    expect(html).toContain('Acknowledged By');
    expect(html).toContain('CSR-000001');
  });

  it('escapes owner-entered content', () => {
    expect(escapeHtml('<script>"test" & more</script>')).toBe(
      '&lt;script&gt;&quot;test&quot; &amp; more&lt;/script&gt;',
    );
  });
});
