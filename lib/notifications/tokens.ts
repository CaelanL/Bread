/**
 * Expo push-token registration and refresh.
 *
 * Token is per-device. Calling getExpoPushTokenAsync without permission
 * throws — gate every call on a `granted`/`provisional` status. The
 * last registered token is cached in AsyncStorage so sign-out and a
 * revoked permission can delete its row.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { deleteDeviceToken, upsertDeviceToken } from './api';
import { getPermissionStatus } from './permissions';

const CACHED_TOKEN_KEY = 'notifications_cached_expo_token';

/**
 * Register or refresh the device token. Idempotent — UPSERT on the
 * server handles repeat calls. It always upserts, even for an unchanged
 * token, because the signed-in user may have changed since the last
 * call, or the row may have been deleted on the server.
 *
 * Returns the token on success, null otherwise (no permission, fetch
 * failed, etc.). Errors are logged, not thrown — token registration
 * is best-effort and runs on foreground/auth events.
 */
export async function registerDeviceToken(): Promise<string | null> {
  const status = await getPermissionStatus();
  if (status !== 'granted' && status !== 'provisional') {
    return null;
  }

  // expo-notifications needs the EAS project id to mint a token. The
  // EAS project id lives in app.config.js extra.eas.projectId.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.error('[notifications] missing EAS projectId');
    return null;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (err) {
    console.error('[notifications] getExpoPushTokenAsync threw', err);
    return null;
  }

  const ok = await upsertDeviceToken(token);
  if (!ok) {
    // Server upsert failed; don't cache so we'll retry next foreground.
    return null;
  }
  await AsyncStorage.setItem(CACHED_TOKEN_KEY, token);
  return token;
}

/** Read the locally-cached token. Used by sign-out cleanup. */
export async function getCachedToken(): Promise<string | null> {
  return AsyncStorage.getItem(CACHED_TOKEN_KEY);
}

/** Clear the cached token. Does NOT touch the server. */
export async function clearCachedToken(): Promise<void> {
  await AsyncStorage.removeItem(CACHED_TOKEN_KEY);
}

/**
 * Delete this device's token row and the cache, so the current user's
 * pushes stop reaching it. Runs on sign-out (while still signed in) and
 * when permission is denied.
 */
export async function unregisterDeviceToken(): Promise<void> {
  const cached = await getCachedToken();
  if (!cached) return;
  await deleteDeviceToken(cached);
  await clearCachedToken();
}
