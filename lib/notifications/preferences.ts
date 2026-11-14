/**
 * Preferences slice: Zustand store for the user's notification prefs,
 * cached to AsyncStorage so the Settings UI doesn't flicker on cold start.
 *
 * Source of truth is Supabase. AsyncStorage is a cache, one per account.
 * Server is read when the account starts (hydrate); local optimistic
 * writes are flushed to the server on every update (with rollback on failure).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  fetchPreferences,
  insertDefaultPreferences,
  updatePreferences as apiUpdatePreferences,
} from './api';
import type { NotificationPreferences } from './types';

// Per account, so the next account on this device never starts from another's prefs.
const prefsCacheKey = (userId: string) => `notifications_prefs_cache:${userId}`;
// Before the cache was per account. Removed on the first hydrate.
const SHARED_CACHE_KEY = 'notifications_prefs_cache';

// The account the store holds, and a count of account changes. A write keeps the account it
// started with: a result that lands after a switch is dropped, never written to the new account.
let account: string | null = null;
let accountRun = 0;

interface PrefsState {
  prefs: NotificationPreferences | null;
  loading: boolean;

  /**
   * Load this account's prefs into the store. Reads its cache first (no
   * flicker), then fetches the canonical server row and overwrites if it
   * differs. Called when the account starts (lib/auth/account.ts).
   */
  hydrate: (userId: string) => Promise<void>;

  /** Wipe the in-memory prefs. Leaves the caches and the server alone. */
  clear: () => void;

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

/** Remove an account's prefs cache: on sign-out, and the current account's from the dev tools. */
export async function clearPrefsCache(userId: string | null = account): Promise<void> {
  if (userId) await AsyncStorage.removeItem(prefsCacheKey(userId));
}

async function readCache(userId: string): Promise<NotificationPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(prefsCacheKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return null;
  }
}

async function writeCache(owner: string | null, prefs: NotificationPreferences | null): Promise<void> {
  if (!owner) return;
  if (prefs == null) {
    await AsyncStorage.removeItem(prefsCacheKey(owner));
    return;
  }
  await AsyncStorage.setItem(prefsCacheKey(owner), JSON.stringify(prefs));
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: null,
  loading: false,

  hydrate: async (userId) => {
    account = userId;
    accountRun++;
    set({ loading: true });
    void AsyncStorage.removeItem(SHARED_CACHE_KEY).catch(() => {});
    const cached = await readCache(userId);
    if (account !== userId) return;
    if (cached) set({ prefs: cached });
    const server = await fetchPreferences();
    if (account !== userId) return;
    if (server) {
      set({ prefs: server, loading: false });
      await writeCache(userId, server);
    } else {
      set({ loading: false });
    }
  },

  clear: () => {
    account = null;
    accountRun++;
    set({ prefs: null, loading: false });
  },

  initializeDefaults: async (timezone) => {
    const [owner, run] = [account, accountRun];
    const server = await insertDefaultPreferences(timezone);
    if (!server || run !== accountRun) return null;
    set({ prefs: server });
    await writeCache(owner, server);
    return server;
  },

  patch: async (patch) => {
    const prev = get().prefs;
    if (!prev) return false;
    const [owner, run] = [account, accountRun];
    const next = { ...prev, ...patch };
    set({ prefs: next });
    await writeCache(owner, next);
    const ok = await apiUpdatePreferences(patch);
    if (!ok) {
      // Roll back: the store only if it still holds this account, the account's own cache always.
      if (run === accountRun) set({ prefs: prev });
      await writeCache(owner, prev);
      return false;
    }
    return true;
  },

  setPrefs: async (prefs) => {
    set({ prefs });
    await writeCache(account, prefs);
  },
}));

/** Selector: full prefs (or null if not yet hydrated/created). */
export function useNotificationPreferences(): NotificationPreferences | null {
  return usePrefsStore((s) => s.prefs);
}
