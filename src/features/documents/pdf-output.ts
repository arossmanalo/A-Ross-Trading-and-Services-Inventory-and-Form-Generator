import * as Print from 'expo-print';

export type PdfPage = 'legal' | 'a4';

/**
 * Page sizes in points (what Android's print framework expects) plus the CSS
 * pixel width of that page. The viewport width is pinned to the page so the
 * layout never depends on the tablet's current screen width or rotation.
 */
export const PDF_PAGES: Record<PdfPage, { width: number; height: number; viewportWidth: number }> = {
  legal: { width: 612, height: 1008, viewportWidth: 816 },
  a4: { width: 595, height: 842, viewportWidth: 794 },
};

const VIEWPORT_TAG = /<meta\s+name=["']viewport["'][^>]*>/i;

/** Print-time only: stored snapshots keep their original markup. */
export function withPrintViewport(html: string, page: PdfPage): string {
  const meta = `<meta name="viewport" content="width=${PDF_PAGES[page].viewportWidth}, initial-scale=1">`;
  if (VIEWPORT_TAG.test(html)) return html.replace(VIEWPORT_TAG, meta);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`);
  return `${meta}${html}`;
}

/** Renders a document to a portrait PDF in the cache directory, independent of device rotation. */
export function printHtmlToPdf(html: string, page: PdfPage, options: { base64?: boolean } = {}) {
  const size = PDF_PAGES[page];
  return Print.printToFileAsync({
    html: withPrintViewport(html, page),
    width: size.width,
    height: size.height,
    base64: options.base64 ?? false,
    textZoom: 100,
  });
}
