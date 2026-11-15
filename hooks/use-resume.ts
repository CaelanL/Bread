import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { resumeTracker } from '@/lib/resume';

/** Calls `onResume` when the app comes back after being away at least RESUME_AWAY_MS (lib/resume.ts). */
export function useResume(onResume: () => void) {
  const latest = useRef(onResume);
  useEffect(() => {
    latest.current = onResume;
  }, [onResume]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', resumeTracker(() => latest.current()));
    return () => subscription.remove();
  }, []);
}
