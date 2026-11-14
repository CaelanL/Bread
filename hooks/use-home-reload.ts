import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';

import { useResume } from '@/hooks/use-resume';
import { localMonthKey } from '@/lib/api/votm';
import { homeStale, type HomeLoad } from '@/lib/resume';
import { useAppStore } from '@/lib/store';

/**
 * A Home read (Verse of the Month, streak) on focus and on return, only when `homeStale` says so.
 * `reload` resolves true once it loaded; a failed one is tried again next time. Pull to refresh
 * calls `reload` directly.
 */
export function useHomeReload(key: string, reload: () => Promise<boolean>) {
  const last = useRef<HomeLoad | null>(null);
  const reloadIfStale = useCallback(() => {
    const next = { key, at: Date.now(), sessionAt: useAppStore.getState().lastSessionAt, month: localMonthKey() };
    if (!homeStale(last.current, next)) return;
    void reload().then((loaded) => {
      if (loaded) last.current = next;
    });
  }, [key, reload]);
  useFocusEffect(reloadIfStale);
  useResume(reloadIfStale);
}
