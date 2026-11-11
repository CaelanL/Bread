import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import type { BibleVersion } from '@/lib/api/bible';
import { localMonthKey } from '@/lib/api/votm';
import { useAuth } from '@/lib/auth';
import { createMonthlyLoader, EMPTY_MONTHLY_STATE } from '@/lib/votm/loader';

export function useVotm(version: BibleVersion) {
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${version}`;
  const [snapshot, setSnapshot] = useState({ scope: '', state: EMPTY_MONTHLY_STATE });
  const loader = useMemo(() => createMonthlyLoader((state) => setSnapshot({ scope, state })), [scope]);
  const refresh = useCallback(() => loader.load(version), [loader, version]);

  useFocusEffect(useCallback(() => {
    let month = localMonthKey();
    void refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') { month = localMonthKey(); void refresh(); }
      else loader.cancel();
    });
    const timer = setInterval(() => {
      const current = localMonthKey();
      if (AppState.currentState === 'active' && current !== month) {
        month = current;
        void refresh();
      }
    }, 60_000);
    return () => { listener.remove(); clearInterval(timer); loader.cancel(); };
  }, [loader, refresh]));

  return { ...(snapshot.scope === scope ? snapshot.state : EMPTY_MONTHLY_STATE), refresh };
}
