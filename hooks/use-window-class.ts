import { useWindowDimensions } from 'react-native';

import { windowClass } from '@/lib/layout';

/** The window's layout class. Updates when the iPhone Duo folds or opens, or the window rotates. */
export function useWindowClass() {
  const { width, height } = useWindowDimensions();
  return windowClass(width, height);
}
