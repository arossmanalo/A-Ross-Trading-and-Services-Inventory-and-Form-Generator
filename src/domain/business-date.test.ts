import { describe, expect, it } from 'vitest';

import { validateBusinessDate } from './business-date';

describe('business dates', () => {
  it('allows today without a reason', () => {
    expect(() => validateBusinessDate('2026-09-06', '', '2026-09-06')).not.toThrow();
  });

  it('requires a reason for a backdated record', () => {
    expect(() => validateBusinessDate('2026-09-05', '', '2026-09-06')).toThrow(/reason/i);
  });

  it('rejects future dates', () => {
    expect(() => validateBusinessDate('2026-09-07', 'test', '2026-09-06')).toThrow(/future/i);
  });
});
