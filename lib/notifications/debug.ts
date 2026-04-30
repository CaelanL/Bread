/**
 * __DEV__-only debug helpers exposed to the global console.
 *
 * Wire into app/_layout.tsx alongside the other dev-tool exposures.
 *
 * Available in dev console:
 *   notifPrefs()         — print current Zustand-cached prefs
 *   notifResetCache()    — wipe AsyncStorage prefs cache + token cache
 *   notifResetUx()       — reset the Q1 explainer + Q14 badge flags
 *                          (lets you re-trigger onboarding without
 *                          reinstalling)
 *   notifPermStatus()    — log current iOS permission status
 *   notifRegisterToken() — force a token register (returns the token)
 *
 * Note: there is intentionally no `notifFire()` helper — exposing the
 * cron secret to the client (even via EXPO_PUBLIC_*) would bundle it
 * into the JS and is a security smell. Test fire-time matches via
 * the manual SQL recipe in the build plan, or wait for the digest
 * to fire at the configured time.
 */

import { clearPrefsCache, usePrefsStore } from './preferences';
import { getPermissionStatus } from './permissions';
import { registerDeviceToken, clearCachedToken } from './tokens';
import { useUxFlagsStore } from './uxFlags';

export function installDevTools(): void {
  if (!__DEV__) return;

  (globalThis as unknown as { notifPrefs: () => void }).notifPrefs = () => {
    const p = usePrefsStore.getState().prefs;
    console.log('[notif] prefs:', JSON.stringify(p, null, 2));
  };

  (globalThis as unknown as { notifPermStatus: () => Promise<void> }).notifPermStatus = async () => {
    const s = await getPermissionStatus();
    console.log('[notif] permission status:', s);
  };

  (globalThis as unknown as { notifRegisterToken: () => Promise<void> }).notifRegisterToken = async () => {
    const t = await registerDeviceToken();
    console.log('[notif] registered token:', t);
  };

  (globalThis as unknown as { notifResetCache: () => Promise<void> }).notifResetCache = async () => {
    await clearPrefsCache();
    await clearCachedToken();
    console.log('[notif] cache cleared');
  };

  (globalThis as unknown as { notifResetUx: () => Promise<void> }).notifResetUx = async () => {
    await useUxFlagsStore.getState().resetForDev();
    console.log('[notif] UX flags reset (Q1 + settings-visited)');
  };
}
