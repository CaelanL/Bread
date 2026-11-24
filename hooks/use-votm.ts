import { useFocusEffect } from 'expo-router/react-navigation';
import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useHomeReload } from '@/hooks/use-home-reload';
import { foregroundRead, type BibleVersion } from '@/lib/api/bible';
import { localMonthKey } from '@/lib/api/votm';
import { useAuth } from '@/lib/auth';
import { createMonthlyLoader, EMPTY_MONTHLY_STATE } from '@/lib/votm/loader';

export function useVotm(version: BibleVersion) {
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${version}`;
  const [snapshot, setSnapshot] = useState({ scope: '', state: EMPTY_MONTHLY_STATE });
  const loader = useMemo(() => createMonthlyLoader((state) => setSnapshot({ scope, state })), [scope]);
  // Home waits on it, so the verse text preload holds back until it settles.
  const refresh = useCallback(() => foregroundRead(loader.load(version)), [loader, version]);
  useHomeReload(scope, refresh);

  useFocusEffect(useCallback(() => {
    let month = localMonthKey();
    const timer = setInterval(() => {
      const current = localMonthKey();
      if (AppState.currentState === 'active' && current !== month) {
        month = current;
        void refresh();
      }
    }, 60_000);
    return () => { clearInterval(timer); loader.cancel(); };
  }, [loader, refresh]));

  return { ...(snapshot.scope === scope ? snapshot.state : EMPTY_MONTHLY_STATE), refresh };
}
