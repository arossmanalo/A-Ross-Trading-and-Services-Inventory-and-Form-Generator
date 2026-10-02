import { DEFAULT_BUSINESS_LOGO_DATA_URL } from '@/features/settings/default-business-logo';
import { normalizeContactDetails } from '@/features/settings/contact-details';

/** Shared print header: both document types use the owner's frozen identity. */
export const DOCUMENT_HEADER_CSS = `
  header.header.aross-header{display:flex;align-items:center;justify-content:flex-start;gap:24px;width:100%;padding-bottom:10px;border-bottom:1.5px solid #0b377f;break-inside:avoid;page-break-inside:avoid}
  .aross-header .mark{display:flex;align-items:center;justify-content:center;flex:0 0 28%;width:28%;max-width:190px;height:78px}
  .aross-header .business-block{flex:1;min-width:0;width:auto;text-align:left}
  .aross-header .business{width:auto;margin:0;font-size:16px;font-weight:800;overflow-wrap:anywhere}
  .aross-header .contact{color:#374151;font-size:9px;font-weight:400;white-space:pre-line;overflow-wrap:anywhere}
`;

export function buildDocumentHeader(business: {
  logoDataUrl?: string | null; name: string; address: string; contactDetails: string;
}): string {
  const logo = business.logoDataUrl?.trim() || DEFAULT_BUSINESS_LOGO_DATA_URL;
  const contact = [business.address, normalizeContactDetails(business.contactDetails)].filter(Boolean).join('\n');
  return headerMarkup(`<img alt="Business logo" src="${escapeHtml(logo)}" style="width:100%;height:100%;object-fit:contain"/>`, escapeHtml(business.name), escapeHtml(contact));
}

/** Repair display layout only, using the saved HTML identity, never today's settings.
 * The original snapshot and generated PDF remain untouched in storage.
 */
export function withDocumentHeaderLayout(original: string): string {
  const match = original.match(/<header class="header(?: aross-header)?">([\s\S]*?)<\/header>/);
  if (!match) return original;
  const header = match[1];
  const logo = header.match(/<div class="mark">([\s\S]*?)<\/div>/)?.[1];
  const name = header.match(/<div class="business-name">([^<]*)<\/div>/)?.[1]
    ?? header.match(/<div class="business">([^<]*)<\/div>/)?.[1];
  const contact = header.match(/<div class="(?:contact|muted)">([^<]*)<\/div>/)?.[1];
  // Unknown historical markup is preserved instead of losing its identity.
  if (logo === undefined || name === undefined || contact === undefined) return original;
  let html = original.replace(match[0], headerMarkup(logo, name, normalizeContactDetails(contact)));
  const style = `<style id="aross-header-layout-v2">${DOCUMENT_HEADER_CSS}</style>`;
  if (!html.includes('id="aross-header-layout-v2"')) {
    html = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : html.replace('</body>', `${style}</body>`);
  }
  return html;
}

function headerMarkup(logo: string, name: string, contact: string): string {
  return `<header class="header aross-header"><div class="mark">${logo}</div><div class="business-block"><div class="business">${name}</div><div class="contact">${contact}</div></div></header>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
