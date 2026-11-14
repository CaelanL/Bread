// lib-ok: starts, switches and clears each account's stores from the auth session
import { syncForegroundState } from '@/lib/notifications/foreground';
import { clearPrefsCache, usePrefsStore } from '@/lib/notifications/preferences';
import { useUxFlagsStore } from '@/lib/notifications/uxFlags';
import { useAppStore } from '@/lib/store';
import { snapshotKey } from '@/lib/store/snapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';

let current: string | null = null;

/**
 * Called with the session's user id when the session is known at launch and on every auth
 * change. The same id does nothing. A new id clears the stores of the account before it (its
 * late responses are dropped by the store's generation check), then starts this one. Null
 * (signed out) clears the stores and removes the previous account's prefs cache and saved
 * library. A launch signed out clears nothing.
 */
export function setAccount(userId: string | null) {
  if (userId === current) return;
  const previous = current;
  current = userId;
  if (previous !== null) {
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
