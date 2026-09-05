/**
 * Keep business forms comfortable to use on both narrow phones and wide
 * tablets. The stack applies this width to every route, so individual screens
 * can continue using their normal ScrollView/FlatList layouts.
 */
export const MAX_CONTENT_WIDTH = 960;

export function getContentWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return MAX_CONTENT_WIDTH;
  }

  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}
