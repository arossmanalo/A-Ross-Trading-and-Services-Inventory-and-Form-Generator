import { describe, expect, it } from 'vitest';

import { buildPdfFileName } from './pdf-file-name';

describe('shared PDF file names', () => {
  it('uses the document ID followed by the document type', () => {
    expect(buildPdfFileName('CSR-000012', 'service_report')).toBe('CSR-000012 Customer Service Report.pdf');
    expect(buildPdfFileName('CSR-000012', 'billing_statement')).toBe('CSR-000012 Billing Statement.pdf');
    expect(buildPdfFileName('PA-000003', 'payment')).toBe('PA-000003 Payment Acknowledgment.pdf');
  });

  it('adds a suffix only when asked', () => {
    expect(buildPdfFileName('CSR-000012', 'billing_statement', 'BS-000045')).toBe('CSR-000012 Billing Statement BS-000045.pdf');
  });

  it('labels unnumbered drafts DRAFT', () => {
    expect(buildPdfFileName(null, 'service_report')).toBe('DRAFT Customer Service Report.pdf');
    expect(buildPdfFileName('  ', 'billing_statement')).toBe('DRAFT Billing Statement.pdf');
  });

  it('removes characters Android and share targets reject', () => {
    expect(buildPdfFileName('CSR/00:1*?', 'service_report')).toBe('CSR 00 1 Customer Service Report.pdf');
  });
});
