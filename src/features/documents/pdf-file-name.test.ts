import { describe, expect, it } from 'vitest';

import { buildPdfFileName } from './pdf-file-name';

describe('shared PDF file names', () => {
  it('is the customer name, then the code, then the date', () => {
    expect(buildPdfFileName({ customerName: 'Juan Dela Cruz', code: 'CSR-000012', date: '2026-09-05' })).toBe('Juan Dela Cruz CSR-000012 2026-09-05.pdf');
    expect(buildPdfFileName({ customerName: 'C & C Laundry', code: 'BS-000045', date: '2026-09-06' })).toBe('C & C Laundry BS-000045 2026-09-06.pdf');
  });

  it('labels unnumbered drafts DRAFT', () => {
    expect(buildPdfFileName({ customerName: 'Laundry', code: null, date: '2026-09-05' })).toBe('Laundry DRAFT 2026-09-05.pdf');
    expect(buildPdfFileName({ customerName: 'Laundry', code: '  ', date: '2026-09-05' })).toBe('Laundry DRAFT 2026-09-05.pdf');
  });

  it('appends a variant such as Signed', () => {
    expect(buildPdfFileName({ customerName: 'Laundry', code: 'CSR-000001', date: '2026-09-05', variant: 'Signed 2' })).toBe('Laundry CSR-000001 2026-09-05 Signed 2.pdf');
  });

  it('removes characters Android and share targets reject, and keeps very long names short', () => {
    expect(buildPdfFileName({ customerName: 'A/B: "Co"*?', code: 'CSR-000001', date: '2026-09-05' })).toBe('A B Co CSR-000001 2026-09-05.pdf');
    const long = buildPdfFileName({ customerName: 'X'.repeat(200), code: 'CSR-000001', date: '2026-09-05' });
    expect(long).toBe(`${'X'.repeat(60)} CSR-000001 2026-09-05.pdf`);
    expect(buildPdfFileName({ customerName: '///', code: 'CSR-000001', date: '2026-09-05' })).toBe('Customer CSR-000001 2026-09-05.pdf');
  });
});
