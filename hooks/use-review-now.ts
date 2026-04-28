/**
 * Returns a `now` Date that re-fires:
 *   - on screen focus (so leaving and coming back picks up new transitions)
 *   - every 60 seconds while focused
 *
 * Used by review-system surfaces (Library list, collection detail, verse
 * cards) so a verse can transition from Locked → Due without the user
 * triggering a manual refresh. The interval clears when the screen blurs
 * to avoid waking the JS thread on background screens.
 *
 * Two API surfaces:
 *   - `useReviewNow()` — owns the timer; the screen at the top of a tab
 *     should call this once. Returns a `now` Date that ticks every 60s
 *     while focused. Wrap descendants that need the same `now` in
 *     `<ReviewNowProvider value={now}>` so they share one tick.
 *   - `useReviewNowValue()` — reads the value from the provider, with a
 *     fallback to a stable Date if no provider exists (so components like
 *     `ReviewStateBadge` work outside the Library too, e.g. on the Setup
 *     screen). This avoids spawning one timer per FlatList row.
 */

import { useFocusEffect } from '@react-navigation/native';
import { createContext, createElement, useCallback, useContext, useState, type ReactNode } from 'react';

const TICK_MS = 60_000;

const ReviewNowContext = createContext<Date | null>(null);

export function useReviewNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const id = setInterval(() => setNow(new Date()), TICK_MS);
      return () => clearInterval(id);
    }, []),
  );

  return now;
}

export function ReviewNowProvider({ value, children }: { value: Date; children: ReactNode }) {
  return createElement(ReviewNowContext.Provider, { value }, children);
}

/**
 * Read the ambient `now` value. Returns the provider value when present;
 * otherwise returns a per-render Date (no timer). List-row components
 * (e.g. ReviewStateBadge inside a FlatList) use this so a single screen-
 * level provider drives all badges with one timer instead of N.
 *
 * Screens that wrap a list with badges should:
 *   const now = useReviewNow();
 *   return <ReviewNowProvider value={now}>...</ReviewNowProvider>;
 */
export function useReviewNowValue(): Date {
  const fromContext = useContext(ReviewNowContext);
  return fromContext ?? new Date();
}
