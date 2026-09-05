export type CapturedSignature = { signerName: string; pngDataUrl: string; createdAt: string };

export function validateSignaturePng(value: string): void {
  if (value.length > 1_000_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('The signature image is invalid or too large. Please draw it again.');
  }
}

export function signatureBlock(signature: CapturedSignature, label: string): string {
  validateSignaturePng(signature.pngDataUrl);
  return `<section style="break-inside:avoid;margin-top:20px;padding:12px;border-top:1px solid #64748b;text-align:center"><img alt="Drawn signature" src="${signature.pngDataUrl}" style="display:block;width:240px;height:90px;object-fit:contain;margin:0 auto"/><strong>${escape(signature.signerName)}</strong><div>${escape(label)}</div><small>Captured ${escape(signature.createdAt)}</small></section>`;
}

export function appendSigningPage(originalHtml: string, blocks: string[], number: string, fingerprint: string, revision: string): string {
  if (!originalHtml.includes('</body>')) throw new Error('The original document template is incomplete.');
  const page = `<section style="break-before:page"><h2>In-person acknowledgment</h2><p>Document ${escape(number)} | Revision 1 | Content fingerprint ${escape(fingerprint)}</p><p>This page records signatures for the preceding finalized document. Its business content is unchanged.</p>${blocks.join('')}<p style="font-size:8px">Signing version ${escape(revision)}. Drawn in person; not a cryptographically verified digital signature.</p></section>`;
  return originalHtml.replace('</body>', `${page}</body>`);
}

function escape(value: string): string {
  return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
