/**
 * iOS permission flow + 4-state status helper.
 *
 * Flow:
 *   undetermined  →  requestPermissionsAsync()  →  granted | denied
 *   granted       →  toggle just flips master_enabled (server)
 *   provisional   →  treated as granted for UX
 *   denied        →  toggle routes to iOS Settings via Linking.openSettings()
 *                    (iOS one-shots requestPermissionsAsync; second call is a no-op)
 */

import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import type { IosPermissionStatus } from './types';

/** Read the OS-level permission status. Maps Expo's PermissionStatus to ours. */
export async function getPermissionStatus(): Promise<IosPermissionStatus> {
  if (Platform.OS !== 'ios') {
    // Android v1 is out of scope (per design doc). For now, treat the
    // platform check as undetermined to keep the UI simple.
    return 'undetermined';
  }
  const res = await Notifications.getPermissionsAsync();
  return mapStatus(res);
}

/**
 * Request permission. iOS one-shots this — calling twice when the
 * status is already 'denied' is a no-op (the user must go to Settings).
 * Returns the post-request status.
 */
export async function requestPermission(): Promise<IosPermissionStatus> {
  if (Platform.OS !== 'ios') return 'undetermined';
  const res = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      // We don't request provisional explicitly; OS may grant it.
    },
  });
  return mapStatus(res);
}

/** Open iOS Settings → app section so the user can re-grant after a 'denied' state. */
export async function openOsSettings(): Promise<void> {
  await Linking.openSettings();
}

function mapStatus(
  res: Notifications.NotificationPermissionsStatus,
): IosPermissionStatus {
  // Prefer the iOS-specific shape when available.
  const ios = res.ios;
  if (ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED) {
    return 'granted';
  }
  if (ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'provisional';
  }
  if (ios?.status === Notifications.IosAuthorizationStatus.DENIED) {
    return 'denied';
  }
  if (ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED) {
    return 'undetermined';
  }
  // Fallback to the generic shape (Android, web, or future iOS shapes).
  switch (res.status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
    default:
      return 'undetermined';
  }
}
