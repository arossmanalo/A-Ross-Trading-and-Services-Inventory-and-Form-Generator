import { describe, expect, it } from 'vitest';

import { getContentWidth, MAX_CONTENT_WIDTH } from './layout';

describe('responsive content layout', () => {
  it('keeps phone content at the available window width', () => {
    expect(getContentWidth(360)).toBe(360);
    expect(getContentWidth(599)).toBe(599);
  });

  it('caps wide tablet content for readable forms', () => {
    expect(getContentWidth(800)).toBe(800);
    expect(getContentWidth(1280)).toBe(MAX_CONTENT_WIDTH);
  });

  it('uses a safe width for an unmeasured window', () => {
    expect(getContentWidth(0)).toBe(MAX_CONTENT_WIDTH);
    expect(getContentWidth(Number.NaN)).toBe(MAX_CONTENT_WIDTH);
  });
});
