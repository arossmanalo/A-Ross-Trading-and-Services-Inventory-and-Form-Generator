import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { mergePdfs } from './pdf-merge';

async function pdf(pages: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of pages) doc.addPage(size);
  return doc.save();
}

async function sizes(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPages().map((page) => [page.getWidth(), page.getHeight()]);
}

describe('merging PDFs', () => {
  it('puts the CSR first and the statement second, each at its own page size', async () => {
    const merged = await mergePdfs([await pdf([[612, 1008]]), await pdf([[595, 842]])]);
    expect(await sizes(merged)).toEqual([[612, 1008], [595, 842]]);
  });

  it('keeps every page of multi-page documents in order', async () => {
    const merged = await mergePdfs([
      await pdf([[612, 1008], [612, 1008]]),
      await pdf([[595, 842], [595, 842], [595, 842]]),
    ]);
    expect(await sizes(merged)).toEqual([[612, 1008], [612, 1008], [595, 842], [595, 842], [595, 842]]);
  });

  it('keeps portrait pages portrait', async () => {
    const merged = await mergePdfs([await pdf([[612, 1008]]), await pdf([[595, 842]])]);
    for (const [width, height] of await sizes(merged)) expect(height).toBeGreaterThan(width);
  });

  it('returns a single document unchanged in page layout, and rejects an empty list or a non-PDF', async () => {
    expect(await sizes(await mergePdfs([await pdf([[595, 842]])]))).toEqual([[595, 842]]);
    await expect(mergePdfs([])).rejects.toThrow(/no PDF/);
    await expect(mergePdfs([new TextEncoder().encode('not a pdf')])).rejects.toThrow();
  });
});
