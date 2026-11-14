import { useState, useCallback } from 'react';
import { useHomeReload } from '@/hooks/use-home-reload';
import { getCurrentStreak } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface UseStreakReturn {
  streak: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and cache the current practice streak. Reloads on focus and app return only when
 * stale or after a session (hooks/use-home-reload.ts); `refresh` always reloads.
 */
export function useStreak(): UseStreakReturn {
  const { user } = useAuth();
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const currentStreak = await getCurrentStreak().catch(() => null);
    if (currentStreak !== null) setStreak(currentStreak);
    setLoading(false);
    return currentStreak !== null;
  }, []);
  useHomeReload(user?.id ?? '', load);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { streak, loading, refresh };
}
