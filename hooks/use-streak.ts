import { useState, useCallback, useEffect, useRef } from 'react';
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
 * stale or after a session (hooks/use-home-reload.ts); `refresh` always reloads. Only the latest
 * read for the current account shows: an older one, or one for an account that left, is dropped.
 */
export function useStreak(): UseStreakReturn {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // Another account: whatever is still in flight is the old one's.
  useEffect(() => {
    latest.current++;
  }, [userId]);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const currentStreak = await getCurrentStreak().catch(() => null);
    if (request !== latest.current) return false;
    if (currentStreak !== null) setStreak(currentStreak);
    setLoading(false);
    return currentStreak !== null;
  }, []);
  useHomeReload(userId, load);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { streak, loading, refresh };
}
