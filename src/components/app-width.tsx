import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The measured width of the app's root view, which follows rotation and
 * Samsung's floating and split windows: the space the app really has.
 */
export const AppWidthContext = createContext<number | null>(null);

/** The app's current width, falling back to the window width before the first layout. */
export function useAppWidth(): number {
  const measured = useContext(AppWidthContext);
  const { width } = useWindowDimensions();
  return measured ?? width;
}
