import { useRef, useCallback } from 'react';

/**
 * Hook to debounce rapid button presses (prevents double-tap issues)
 * @param onPress - The press handler to debounce
 * @param delay - Minimum time between presses in ms (default 500ms)
 * @param sharedLastPress - Lets sibling buttons share one window, so a quick tap on another one is ignored too
 */
export function useDebouncedPress<A extends unknown[]>(
  onPress: (...args: A) => void,
  delay = 500,
  sharedLastPress?: { current: number },
) {
  const ownLastPress = useRef(0);
  const lastPressRef = sharedLastPress ?? ownLastPress;

  return useCallback((...args: A) => {
    const now = Date.now();
    if (now - lastPressRef.current > delay) {
      lastPressRef.current = now;
      onPress(...args);
    }
  }, [onPress, delay, lastPressRef]);
}
