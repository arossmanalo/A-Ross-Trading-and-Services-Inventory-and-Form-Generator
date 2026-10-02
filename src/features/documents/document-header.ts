import { DEFAULT_BUSINESS_LOGO_DATA_URL } from '@/features/settings/default-business-logo';
import { normalizeContactDetails } from '@/features/settings/contact-details';

/** Shared print header: both document types use the owner's frozen identity. */
export const DOCUMENT_HEADER_CSS = `
  .header{display:flex;align-items:center;gap:24px;padding-bottom:10px;border-bottom:1.5px solid #0b377f;break-inside:avoid}
  .mark{display:flex;align-items:center;justify-content:center;flex:0 0 190px;height:78px}
  .business-block{flex:1;min-width:0;text-align:left}
  .business{font-size:16px;font-weight:800;overflow-wrap:anywhere}
  .contact{color:#374151;font-size:9px;white-space:pre-line;overflow-wrap:anywhere}
`;

export function buildDocumentHeader(business: {
  logoDataUrl?: string | null; name: string; address: string; contactDetails: string;
}): string {
  const logo = business.logoDataUrl?.trim() || DEFAULT_BUSINESS_LOGO_DATA_URL;
  const contact = [business.address, normalizeContactDetails(business.contactDetails)].filter(Boolean).join('\n');
  return `<header class="header"><div class="mark"><img alt="Business logo" src="${escapeHtml(logo)}" style="width:100%;height:100%;object-fit:contain"/></div><div class="business-block"><div class="business">${escapeHtml(business.name)}</div><div class="contact">${escapeHtml(contact)}</div></div></header>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
