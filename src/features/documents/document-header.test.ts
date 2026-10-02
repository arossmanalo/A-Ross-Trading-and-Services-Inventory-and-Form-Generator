import { describe, expect, it } from 'vitest';
import { buildDocumentHeader, withDocumentHeaderLayout } from '@/features/documents/document-header';

describe('saved document header layout', () => {
  it('repairs legacy Billing Statement markup from its frozen identity, not settings', () => {
    const original = '<html><head><style>.business{width:250px}.mark{width:92px}</style></head><body><header class="header"><div class="mark"><img src="data:image/png;base64,SAVED"/></div><div class="business"><div class="business-name">Frozen &amp; Company</div><div class="muted">Saved address\nowner@example.com\n0917\n0920</div></div></header><p>Frozen amounts: 1000</p><footer>BS-1 fingerprint</footer></body></html>';
    const repaired = withDocumentHeaderLayout(original);
    expect(repaired).toContain('class="header aross-header"');
    expect(repaired).toContain('class="business-block"');
    expect(repaired).toContain('class="business">Frozen &amp; Company');
    expect(repaired).toContain('Saved address\n0917\n0920\nowner@example.com');
    expect(repaired).toContain('data:image/png;base64,SAVED');
    expect(repaired).toContain('<p>Frozen amounts: 1000</p><footer>BS-1 fingerprint</footer>');
    expect(repaired).toContain('aross-header-layout-v2');
    expect(withDocumentHeaderLayout(repaired)).toBe(repaired);
  });

  it('gives saved CSR and new Billing Statement headers the same markup and layout', () => {
    const business = {name:'Frozen Owner',address:'Saved address',contactDetails:'0917\nemail@example.com',logoDataUrl:'data:image/png;base64,SAVED'};
    const current = buildDocumentHeader(business);
    const legacy = current.replace('header aross-header', 'header');
    const repaired = withDocumentHeaderLayout(`<html><head></head><body>${legacy}</body></html>`);
    expect(repaired).toContain(current);
    expect(repaired).toContain('flex:0 0 28%');
    expect(repaired).not.toContain('flex:0 0 190px');
  });

  it('leaves unknown historical headers unchanged instead of erasing data', () => {
    const html = '<html><body><header class="header">Handmade owner header</header></body></html>';
    expect(withDocumentHeaderLayout(html)).toBe(html);
  });
});
