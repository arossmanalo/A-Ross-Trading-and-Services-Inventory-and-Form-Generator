import { describe, expect, it, vi } from 'vitest';

import { runShareSequence, type ShareStep } from './share-sequence';

const step = (title: string, run: () => Promise<void> = vi.fn(async () => undefined)): ShareStep => ({ title, fileName: `${title}.pdf`, run });

describe('share sequence', () => {
  it('shares the first document without asking, then asks before each later one', async () => {
    const [a, b, c] = [step('A'), step('B'), step('C')];
    const confirm = vi.fn(async (_next: ShareStep) => true);
    expect(await runShareSequence([a, b, c], confirm)).toBe(3);
    expect(confirm.mock.calls.map(([next]) => next.title)).toEqual(['B', 'C']);
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it('stops when the user skips a later document', async () => {
    const [a, b, c] = [step('A'), step('B'), step('C')];
    expect(await runShareSequence([a, b, c], async (next) => next.title !== 'B')).toBe(1);
    expect(b.run).not.toHaveBeenCalled();
    expect(c.run).not.toHaveBeenCalled();
  });

  it('does not continue after a failed share', async () => {
    const failing = step('A', async () => { throw new Error('Sharing failed'); });
    const b = step('B');
    await expect(runShareSequence([failing, b], async () => true)).rejects.toThrow('Sharing failed');
    expect(b.run).not.toHaveBeenCalled();
  });
});
