/**
 * Hook backing the Q14 "1" badge on the Settings tab.
 *
 * Returns true when the user should be nudged toward Settings to
 * complete notification setup:
 *
 *   1. The Q1 explainer card has been dismissed (uxFlags store).
 *   2. iOS permission status is `undetermined` OR `denied`.
 *   3. The user has at least 1 verse in their library.
 *
 * Disappears the first time the user visits Settings (the Settings
 * screen calls `markSettingsVisited()` on mount).
 *
 * UX flags live in a Zustand store rather than raw AsyncStorage so
 * the badge re-renders the moment a flag flips, without waiting for
 * the next AppState 'active' event.
 */

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAppStore } from '@/lib/store';
import { getPermissionStatus } from './permissions';
import { useUxFlagsStore } from './uxFlags';

export function useSettingsBadge(): boolean {
  // Subscribe to verse count + UX flags. The instant any of these
  // change in the same JS turn, the hook re-evaluates.
  const hasVerses = useAppStore((s) => s.verses.length > 0);
  const q1Dismissed = useUxFlagsStore((s) => s.q1Dismissed);
  const settingsVisited = useUxFlagsStore((s) => s.settingsVisited);
  const flagsHydrated = useUxFlagsStore((s) => s.hydrated);

  const [permissionGate, setPermissionGate] = useState(false);

  // Re-probe permission status on mount + each app foreground (the
  // user may grant via iOS Settings without the in-app flow).
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const status = await getPermissionStatus();
      if (!cancelled) {
        setPermissionGate(status === 'undetermined' || status === 'denied');
      }
    };
    probe();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') probe();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  if (!flagsHydrated) return false;
  if (settingsVisited) return false;
  if (!q1Dismissed) return false;
  return permissionGate && hasVerses;
}

// Re-export markSettingsVisited so callers don't import from two
// modules. Backward-compat — same name, just delegates.
export const markSettingsVisited = (): Promise<void> =>
  useUxFlagsStore.getState().markSettingsVisited();
