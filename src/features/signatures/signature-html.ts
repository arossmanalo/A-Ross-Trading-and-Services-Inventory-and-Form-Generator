export type CapturedSignature = { signerName: string; pngDataUrl: string; createdAt: string };
type SignatureRole = 'customer' | 'preparer';
type SignatureMark = { role: SignatureRole; signerNameHtml: string; pngDataUrl: string };

const SIGNATURE_LAYOUT_CSS = `
.signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:22px;break-inside:avoid;page-break-inside:avoid}
.signature{min-width:0;border:0!important;padding:0!important;text-align:center;break-inside:avoid;page-break-inside:avoid}
.signature-writing{height:38px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
.signature-image{display:block;width:78%;max-width:180px;height:34px;object-fit:contain;object-position:center bottom}
.signature-line{height:0;border-top:1px solid #111827}
.signature-name{min-height:14px;padding-top:3px;font-size:8px;font-weight:700;overflow-wrap:anywhere}
.signature-label{color:#475569;font-size:8px;text-transform:uppercase}
`;

export function validateSignaturePng(value: string): void {
  if (value.length > 1_000_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('The signature image is invalid or too large. Please draw it again.');
  }
}

/** Returns a portable signature block; document templates place it in the correct signature slot. */
export function signatureBlock(signature: CapturedSignature, label: string): string {
  validateSignaturePng(signature.pngDataUrl);
  return `<section style="break-inside:avoid;margin-top:20px;padding:12px;border-top:1px solid #64748b;text-align:center"><img alt="Drawn signature" src="${signature.pngDataUrl}" style="display:block;width:240px;height:90px;object-fit:contain;margin:0 auto"/><strong>${escape(signature.signerName)}</strong><div>${escape(label)}</div><small>Captured ${escape(signature.createdAt)}</small></section>`;
}

/**
 * Places captured signature marks on the existing first-page signature lines.
 * It also normalizes older saved snapshots that appended a forced acknowledgment page.
 */
export function applySignatureCapturesToDocument(originalHtml: string, blocks: string[]): string {
  if (!originalHtml.includes('</body>')) throw new Error('The original document template is incomplete.');

  const marks: SignatureMark[] = [];
  let html = originalHtml;
  const legacyPage = removeLegacyAcknowledgmentPage(html);
  html = legacyPage.html;

  const legacyLooseBlocks = extractLegacySignatureBlocks(html);
  html = legacyLooseBlocks.html;
  marks.push(...legacyLooseBlocks.marks, ...legacyPage.marks);

  for (const block of blocks) marks.push(...parseSignatureMarkers(block));

  html = normalizeSignatureSlots(html);
  html = ensureSignatureSlots(html);

  // Later captures override the saved default signature and older duplicate legacy entries.
  const latestByRole = new Map<SignatureRole, SignatureMark>();
  for (const mark of marks) latestByRole.set(mark.role, mark);
  for (const mark of latestByRole.values()) html = applyMarkToSlot(html, mark);

  return addSignatureStyles(html);
}

function parseSignatureMarkers(markup: string): SignatureMark[] {
  const marks: SignatureMark[] = [];
  const marker = /<template\s+data-signature-role="(customer|preparer)"\s+data-signer-name="([^"]*)"\s+data-captured-at="[^"]*">\s*<img\s+src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"\s*\/>\s*<\/template>/g;
  for (const match of markup.matchAll(marker)) {
    validateSignaturePng(match[3]);
    marks.push({ role: match[1] as SignatureRole, signerNameHtml: match[2], pngDataUrl: match[3] });
  }
  const legacy = /<section style="break-inside:avoid;margin-top:20px;padding:12px;border-top:1px solid #64748b;text-align:center">([\s\S]*?)<\/section>/gi;
  for (const match of markup.matchAll(legacy)) {
    const mark = parseLegacySignatureBlock(match[1]);
    if (mark) marks.push(mark);
  }
  return marks;
}

function removeLegacyAcknowledgmentPage(html: string): { html: string; marks: SignatureMark[] } {
  const heading = html.indexOf('<h2>In-person acknowledgment</h2>');
  if (heading < 0) return { html, marks: [] };
  const sectionStart = html.lastIndexOf('<section', heading);
  if (sectionStart < 0) return { html, marks: [] };
  const sectionEnd = findMatchingSectionEnd(html, sectionStart);
  if (sectionEnd < 0) return { html, marks: [] };
  const page = html.slice(sectionStart, sectionEnd);
  const extracted = extractLegacySignatureBlocks(page);
  return {
    html: `${html.slice(0, sectionStart)}${html.slice(sectionEnd)}`,
    marks: extracted.marks,
  };
}

function findMatchingSectionEnd(html: string, sectionStart: number): number {
  const tags = /<\/?section\b[^>]*>/gi;
  let depth = 0;
  for (const match of html.slice(sectionStart).matchAll(tags)) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return sectionStart + match.index! + match[0].length;
  }
  return -1;
}

function extractLegacySignatureBlocks(html: string): { html: string; marks: SignatureMark[] } {
  const marks: SignatureMark[] = [];
  const legacy = /<section style="break-inside:avoid;margin-top:20px;padding:12px;border-top:1px solid #64748b;text-align:center">([\s\S]*?)<\/section>/gi;
  const cleaned = html.replace(legacy, (whole, content: string) => {
    const mark = parseLegacySignatureBlock(content);
    if (!mark) return whole;
    marks.push(mark);
    return '';
  });
  return { html: cleaned, marks };
}

function parseLegacySignatureBlock(content: string): SignatureMark | null {
  const image = content.match(/<img[^>]*src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/i)?.[1];
  const name = content.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1];
  const label = content.match(/<div>([\s\S]*?)<\/div>/i)?.[1];
  if (!image || name === undefined || !label) return null;
  validateSignaturePng(image);
  return {
    role: label.toLowerCase().includes('customer') ? 'customer' : 'preparer',
    signerNameHtml: name,
    pngDataUrl: image,
  };
}

function normalizeSignatureSlots(html: string): string {
  const legacy = /<div class="signature"><div class="signature-name">([\s\S]*?)<\/div><div class="signature-label">(Serviced By|Acknowledged By)<\/div><\/div>/g;
  return html.replace(legacy, (_whole, name: string, label: string) => {
    const role: SignatureRole = label === 'Acknowledged By' ? 'customer' : 'preparer';
    return signatureSlot(role, name, label);
  });
}

function ensureSignatureSlots(html: string): string {
  const roles = [...html.matchAll(/data-signature-role="(customer|preparer)"/g)].map((match) => match[1]);
  if (roles.includes('customer') && roles.includes('preparer')) return html;

  const missing = (['preparer', 'customer'] as const)
    .filter((role) => !roles.includes(role))
    .map((role) => signatureSlot(role, '', role === 'preparer' ? 'Prepared By' : 'Customer'))
    .join('');
  if (html.includes('<section class="signatures">')) {
    const start = html.indexOf('<section class="signatures">');
    const end = findMatchingSectionEnd(html, start);
    if (end >= 0) return `${html.slice(0, end - '</section>'.length)}${missing}${html.slice(end - '</section>'.length)}`;
  }
  const section = `<section class="signatures">${missing}</section>`;
  if (html.includes('<footer')) return html.replace('<footer', `${section}<footer`);
  return html.replace('</body>', `${section}</body>`);
}

function signatureSlot(role: SignatureRole, signerNameHtml: string, label: string): string {
  return `<div class="signature" data-signature-role="${role}"><div class="signature-writing" data-signature-image-slot="${role}"></div><div class="signature-line"></div><div class="signature-name" data-signature-name-slot="${role}">${signerNameHtml}</div><div class="signature-label">${label}</div></div>`;
}

function applyMarkToSlot(html: string, mark: SignatureMark): string {
  const imageSlot = new RegExp(`<div class="signature-writing" data-signature-image-slot="${mark.role}">[\\s\\S]*?<\\/div>`);
  const signatureImage = `<img class="signature-image" alt="${mark.role === 'customer' ? 'Customer' : 'Preparer'} signature" src="${mark.pngDataUrl}"/>`;
  let result = html.replace(imageSlot, `<div class="signature-writing" data-signature-image-slot="${mark.role}">${signatureImage}</div>`);
  const nameSlot = new RegExp(`(<div class="signature-name" data-signature-name-slot="${mark.role}">)[\\s\\S]*?(<\\/div>)`);
  result = result.replace(nameSlot, `$1${mark.signerNameHtml}$2`);
  return result;
}

function addSignatureStyles(html: string): string {
  const styleTag = `<style id="signature-layout-inline-v1">${SIGNATURE_LAYOUT_CSS}</style>`;
  if (html.includes('id="signature-layout-inline-v1"')) return html;
  if (html.includes('</head>')) return html.replace('</head>', `${styleTag}</head>`);
  return html.replace('</body>', `${styleTag}</body>`);
}

function escape(value: string): string {
  return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
