import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The measured width of the app's root view. On Android the window size
 * reported to JavaScript can stay on the old orientation when the app starts
 * behind the lock screen or rotates while in the background; the root view's
 * own layout always matches what is on screen.
 */
export const AppWidthContext = createContext<number | null>(null);

/** The app's current width, falling back to the window width before the first layout. */
export function useAppWidth(): number {
  const measured = useContext(AppWidthContext);
  const { width } = useWindowDimensions();
  return measured ?? width;
}
