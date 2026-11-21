import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { saveDevTiming } from '@/lib/api/dev-timing';
import { canDevSignIn, DEV_SIGN_IN_PASSWORD } from '@/lib/auth/dev-sign-in';
import { useUxFlagsStore } from '@/lib/notifications';

/**
 * Dev only: signs in as a seed user, then opens a route, so `npm run sim` can
 * see signed-in screens without taps. com.biblemem://dev-sign-in?next=/settings&as=reader-b
 * `latency=<ms>` delays every Supabase request and `perf=1` logs [PERF] timing lines, from now
 * and on later launches (lib/api/dev-timing.ts); each sign-in resets both.
 * Does nothing but go home in a production build or against a non-local Supabase.
 */
export default function DevSignIn() {
  const { next, as, latency, perf } = useLocalSearchParams<{ next?: string; as?: string; latency?: string; perf?: string }>();
  const { signIn } = useAuth();

  useEffect(() => {
    (async () => {
      if (canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL)) {
        // The reminders card would cover every screenshot, and simctl can't tap it away.
        await useUxFlagsStore.getState().markQ1Dismissed();
        await saveDevTiming(Number(latency) || 0, perf === '1');
        const { error } = await signIn(`${as ?? 'reader-a'}@example.test`, DEV_SIGN_IN_PASSWORD);
        if (error) console.error('[dev-sign-in]', error);
        else {
          // An invite opens over the Library, the way a signed-out link tap does after sign-in.
          if (next?.startsWith('/join')) {
            router.replace('/(tabs)/(library)');
            router.push(next as Href);
          } else {
            router.replace((next ?? '/') as Href);
          }
          return;
        }
      }
      router.replace('/');
    })();
    // Runs once per deep link; signIn changes identity on every auth update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, as, latency, perf]);

  return null;
}
