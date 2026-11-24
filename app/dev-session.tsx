import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { canDevSignIn } from '@/lib/auth/dev-sign-in';

/**
 * Dev only: opens a study session in a board's state, for shots on the open Duo.
 * `npm run sim -- shot "/dev-session?s=<verse id>,<difficulty>,<chunk size>,<demo>"`, where demo is
 * read by `useSessionDemo` (e.g. `rec`, `done2`, `done2+finish`, `rec+closed`). One param, since the
 * dev sign-in hop keeps only the first. Goes home in a production build or against a non-local Supabase.
 */
export default function DevSession() {
  const { s = '' } = useLocalSearchParams<{ s?: string }>();
  const allowed = canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL);

  useEffect(() => {
    if (!allowed) {
      router.replace('/');
      return;
    }
    const [id, difficulty = 'easy', chunkSize = '1', demo = ''] = s.split(',');
    router.replace({ pathname: '/session', params: { id, difficulty, chunkSize, demo } });
  }, [allowed, s]);

  return null;
}
