import { PDFDocument } from 'pdf-lib';

/**
 * Joins PDFs into one, in order, keeping every page at its own size (a Legal
 * CSR followed by an A4 Billing Statement stays Legal then A4).
 */
export async function mergePdfs(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 0) throw new Error('There is no PDF to send.');
  const merged = await PDFDocument.create();
  for (const bytes of parts) {
    const source = await PDFDocument.load(bytes);
    for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
  }
  return merged.save();
}
