import { describe, expect, it } from 'vitest';

import { validateBusinessDate } from './business-date';

describe('business dates', () => {
  it('allows today without a reason', () => {
    expect(() => validateBusinessDate('2026-09-06', '2026-09-06')).not.toThrow();
  });

  it('allows a backdated record without a reason', () => {
    expect(() => validateBusinessDate('2026-09-05', '2026-09-06')).not.toThrow();
    expect(() => validateBusinessDate('2020-01-31', '2026-09-06')).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() => validateBusinessDate('09/05/2026', '2026-09-06')).toThrow(/YYYY-MM-DD/);
    expect(() => validateBusinessDate('2026-02-30x', '2026-09-06')).toThrow(/YYYY-MM-DD/);
  });

  it('rejects future dates', () => {
    expect(() => validateBusinessDate('2026-09-07', '2026-09-06')).toThrow(/future/i);
  });
});
