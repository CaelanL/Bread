// lib-ok: starts, switches and clears each account's stores from the auth session
import { syncForegroundState } from '@/lib/notifications/foreground';
import { clearPrefsCache, usePrefsStore } from '@/lib/notifications/preferences';
import { useUxFlagsStore } from '@/lib/notifications/uxFlags';
import { useAppStore } from '@/lib/store';
import { snapshotKey } from '@/lib/store/snapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';

let current: string | null = null;
// The current account's library load has started (not just its saved library painted).
let started = false;

/**
 * Called with the session's user id when the session is known at launch and on every auth
 * change. The same id does nothing. A new id clears the stores of the account before it (its
 * late responses are dropped by the store's generation check), then starts this one. Null
 * (signed out) clears the stores and removes the previous account's prefs cache and saved
 * library. A launch signed out clears nothing. `provisional`: the stored session's user while the
 * session is still being restored; paints that account's saved library and starts nothing on the
 * network, until a call without it.
 */
export function setAccount(userId: string | null, { provisional = false } = {}) {
  if (userId === current && (userId === null || started || provisional)) return;
  const previous = current;
  if (userId !== previous) started = false;
  current = userId;
  if (previous !== null && userId !== previous) {
    useAppStore.getState().clear();
    usePrefsStore.getState().clear();
  }
  if (userId === null) {
    clearPrefsCache(previous).catch((e) => console.error('[account] Failed to remove the prefs cache:', e));
    if (previous) {
      AsyncStorage.removeItem(snapshotKey(previous)).catch((e) => console.error('[account] Failed to remove the snapshot:', e));
    }
    return;
  }
  if (provisional) {
    useAppStore.getState().paintSnapshot(userId).catch((e) => console.error('[account] Snapshot paint error:', e));
    return;
  }

  started = true;
  useAppStore.getState().hydrate(userId).catch((e) => console.error('[account] Store hydration error:', e));
  // So the explainer card and the Settings badge resolve without a flicker.
  useUxFlagsStore.getState().hydrate().catch(() => { /* best-effort */ });
  // Prefs (cache, then server), then one foreground sync (token, time zone, heartbeat).
  (async () => {
    await usePrefsStore.getState().hydrate(userId);
    if (current !== userId) return;
    await syncForegroundState();
  })().catch((e) => console.error('[account] Notification hydration', e));
}
