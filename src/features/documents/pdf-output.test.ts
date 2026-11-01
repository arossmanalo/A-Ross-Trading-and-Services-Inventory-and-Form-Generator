import { describe, expect, it, vi } from 'vitest';

const printToFileAsync = vi.hoisted(() => vi.fn(async (_options: { width: number; height: number; base64: boolean; html: string }) => ({ uri: 'file://cache/out.pdf', numberOfPages: 1 })));
vi.mock('expo-print', () => ({ printToFileAsync }));

import { PDF_PAGES, printHtmlToPdf, withPrintViewport } from './pdf-output';

describe('print viewport normalization', () => {
  it('replaces a device-width viewport with the page width', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>x</body></html>';
    const out = withPrintViewport(html, 'legal');
    expect(out).toContain('content="width=816, initial-scale=1"');
    expect(out).not.toContain('device-width');
    expect(out.match(/name="viewport"/g)).toHaveLength(1);
  });

  it('adds a viewport when none exists, with or without a head element', () => {
    expect(withPrintViewport('<html><head></head><body></body></html>', 'a4')).toContain('<head><meta name="viewport" content="width=794, initial-scale=1">');
    expect(withPrintViewport('<p>bare</p>', 'a4').startsWith('<meta name="viewport" content="width=794')).toBe(true);
  });

  it('prints portrait pages at the document size', async () => {
    await printHtmlToPdf('<html><head></head><body>x</body></html>', 'legal', { base64: true });
    const options = printToFileAsync.mock.calls[0][0];
    expect(options).toMatchObject({ width: 612, height: 1008, base64: true });
    expect(options.height).toBeGreaterThan(options.width);
    expect(PDF_PAGES.a4.height).toBeGreaterThan(PDF_PAGES.a4.width);
    expect(options.html).toContain('width=816');
  });
});
