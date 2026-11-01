export type ShareStep = {
  /** Shown to the user, for example "Billing Statement". */
  title: string;
  fileName: string;
  run: () => Promise<void>;
};

/**
 * Android's share sheet carries one file at a time, so related documents are
 * shared one after another. The first sheet opens immediately; each later one
 * waits for `confirmNext` so it is launched while the app is in the foreground.
 * Returns how many documents were handed to a share sheet.
 */
export async function runShareSequence(steps: readonly ShareStep[], confirmNext: (next: ShareStep) => Promise<boolean>): Promise<number> {
  let shared = 0;
  for (const [index, step] of steps.entries()) {
    if (index > 0 && !(await confirmNext(step))) break;
    await step.run();
    shared += 1;
  }
  return shared;
}
