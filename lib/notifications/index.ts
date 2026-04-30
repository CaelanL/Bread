/**
 * Public surface for the notifications module.
 *
 * Hooks:
 *   useNotificationPreferences  — Zustand selector (null until hydrated)
 *
 * Prefs actions (wrappers around the Zustand store):
 *   hydratePreferences, clearPreferences, initializeDefaults, patchPreferences
 *
 * Permission flow:
 *   getPermissionStatus, requestPermission, openOsSettings
 *
 * Tokens, foreground sync, deep links, dev tools:
 *   registerDeviceToken, clearCachedToken
 *   syncForegroundState (TZ + last-foregrounded-at + token refresh)
 *   registerDeepLinkHandler
 *   installDevTools (__DEV__ only)
 */

export type {
  Cadence,
  NotificationPreferences,
  NotificationDeepLink,
  IosPermissionStatus,
} from './types';

import { usePrefsStore } from './preferences';
import type { NotificationPreferences } from './types';

export { useNotificationPreferences, usePrefsStore } from './preferences';

export const hydratePreferences = (): Promise<void> =>
  usePrefsStore.getState().hydrate();
export const clearPreferences = (): Promise<void> =>
  usePrefsStore.getState().clear();
export const initializeDefaults = (timezone: string): Promise<NotificationPreferences | null> =>
  usePrefsStore.getState().initializeDefaults(timezone);
export const patchPreferences = (patch: Partial<NotificationPreferences>): Promise<boolean> =>
  usePrefsStore.getState().patch(patch);

export {
  getPermissionStatus,
  requestPermission,
  openOsSettings,
} from './permissions';

export {
  registerDeviceToken,
  getCachedToken,
  clearCachedToken,
} from './tokens';

export { registerDeepLinkHandler, replayColdStartTap } from './deep-links';

export { installDevTools } from './debug';

export { syncForegroundState } from './foreground';

export { useSettingsBadge, markSettingsVisited } from './useSettingsBadge';

export { useUxFlagsStore } from './uxFlags';

export {
  fetchPreferences,
  updateLastForegroundedAt,
  updateTimezone,
  defaultPreferences,
} from './api';
