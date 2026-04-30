/**
 * Preferences slice: Zustand store for the user's notification prefs,
 * cached to AsyncStorage so the Settings UI doesn't flicker on cold start.
 *
 * Source of truth is Supabase. AsyncStorage is a cache. Server is
 * read on sign-in (hydrate); local optimistic writes are flushed to
 * the server on every update (with rollback on failure).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  fetchPreferences,
  insertDefaultPreferences,
  updatePreferences as apiUpdatePreferences,
} from './api';
import type { NotificationPreferences } from './types';

const PREFS_CACHE_KEY = 'notifications_prefs_cache';

interface PrefsState {
  prefs: NotificationPreferences | null;
  loading: boolean;

  /**
   * Load prefs into store. Reads cache first (no flicker), then
   * fetches the canonical server row and overwrites if it differs.
   * Called on sign-in.
   */
  hydrate: () => Promise<void>;

  /** Wipe local state. Called on sign-out. Does NOT touch server. */
  clear: () => Promise<void>;

  /**
   * INSERT default prefs row (called when permission is freshly
   * granted and no server row exists). Updates store + cache.
   */
  initializeDefaults: (timezone: string) => Promise<NotificationPreferences | null>;

  /**
   * UPDATE prefs (any subset). Optimistic local update + cache write,
   * then server flush. On server failure, rolls back to the
   * pre-patch values.
   */
  patch: (patch: Partial<NotificationPreferences>) => Promise<boolean>;

  /** Direct setter — used by foreground-driven TZ resync. */
  setPrefs: (prefs: NotificationPreferences | null) => Promise<void>;
}

/** Wipe the prefs AsyncStorage cache. Used by sign-out and dev tools. */
export async function clearPrefsCache(): Promise<void> {
  await AsyncStorage.removeItem(PREFS_CACHE_KEY);
}

async function readCache(): Promise<NotificationPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return null;
  }
}

async function writeCache(prefs: NotificationPreferences | null): Promise<void> {
  if (prefs == null) {
    await AsyncStorage.removeItem(PREFS_CACHE_KEY);
    return;
  }
  await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: null,
  loading: false,

  hydrate: async () => {
    set({ loading: true });
    const cached = await readCache();
    if (cached) set({ prefs: cached });
    const server = await fetchPreferences();
    if (server) {
      set({ prefs: server, loading: false });
      await writeCache(server);
    } else {
      set({ loading: false });
    }
  },

  clear: async () => {
    set({ prefs: null, loading: false });
    await writeCache(null);
  },

  initializeDefaults: async (timezone) => {
    const server = await insertDefaultPreferences(timezone);
    if (!server) return null;
    set({ prefs: server });
    await writeCache(server);
    return server;
  },

  patch: async (patch) => {
    const prev = get().prefs;
    if (!prev) return false;
    const next = { ...prev, ...patch };
    set({ prefs: next });
    await writeCache(next);
    const ok = await apiUpdatePreferences(patch);
    if (!ok) {
      // Roll back.
      set({ prefs: prev });
      await writeCache(prev);
      return false;
    }
    return true;
  },

  setPrefs: async (prefs) => {
    set({ prefs });
    await writeCache(prefs);
  },
}));

/** Selector: full prefs (or null if not yet hydrated/created). */
export function useNotificationPreferences(): NotificationPreferences | null {
  return usePrefsStore((s) => s.prefs);
}
