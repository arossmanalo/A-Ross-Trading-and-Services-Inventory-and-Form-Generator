/**
 * Screens use the full viewport so tablet content is not isolated in a narrow
 * centered column. Individual screens provide their own internal padding and
 * responsive wrapping for readable forms and lists.
 */
export const MIN_CONTENT_WIDTH = 320;

export function getContentWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return MIN_CONTENT_WIDTH;
  }

  return windowWidth;
}
