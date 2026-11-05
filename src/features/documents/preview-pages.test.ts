import { describe, expect, it } from 'vitest';

import { combinePreviewPages } from './preview-pages';

describe('combinePreviewPages', () => {
  it('returns a single document untouched', () => {
    expect(combinePreviewPages(['<html>one</html>'])).toBe('<html>one</html>');
  });

  it('puts each document in its own frame, in order, with attributes escaped', () => {
    const html = combinePreviewPages(['<p class="a">CSR & more</p>', '<p>Statement</p>']);
    expect(html.match(/<iframe /g)).toHaveLength(2);
    expect(html.indexOf('CSR &amp;amp; more')).toBeGreaterThan(-1);
    expect(html.indexOf('class=&quot;a&quot;')).toBeLessThan(html.indexOf('Statement'));
    expect(html).not.toContain('class="a"');
  });
});
