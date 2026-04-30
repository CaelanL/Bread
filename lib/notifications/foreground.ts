/**
 * Foreground-event sync: runs once per app foreground after sign-in.
 *
 * Per the design doc's "Reconciliation triggers (client → server)"
 * table, we:
 *
 *   1. Re-check iOS permission status; clear local token cache if it
 *      flipped granted → denied.
 *   2. If permission is granted/provisional, register/refresh the
 *      device token (UPSERT, idempotent).
 *   3. Compare device IANA TZ against the cached prefs row; if
 *      different, UPDATE notification_preferences.timezone.
 *   4. Fire the debounced last_foregrounded_at heartbeat (server-side
 *      no-ops if recent).
 *
 * Best-effort: every step swallows its error and continues. The 24h
 * gate, digest fire-time, and token registration all self-heal across
 * subsequent foregrounds.
 */

import {
  registerDeviceToken,
  clearCachedToken,
  getCachedToken,
} from './tokens';
import { getPermissionStatus } from './permissions';
import {
  deleteDeviceToken,
  updateLastForegroundedAt,
  updateTimezone,
} from './api';
import { usePrefsStore } from './preferences';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function syncForegroundState(): Promise<void> {
  const status = await getPermissionStatus();

  if (status === 'denied') {
    // User revoked externally. Belt-and-suspenders alongside server-
    // side DeviceNotRegistered: delete the row, clear local cache.
    const cached = await getCachedToken();
    if (cached) {
      await deleteDeviceToken(cached);
      await clearCachedToken();
    }
  } else if (status === 'granted' || status === 'provisional') {
    // UPSERT token (no-op if cached token unchanged).
    const token = await registerDeviceToken();

    // If permission was just granted via iOS Settings (post a prior
    // deny / fresh install) without going through the in-app explainer
    // card, the user has a token but no prefs row. Insert defaults so
    // the cron can match them. Idempotent — initializeDefaults is only
    // called when prefs is null in the store.
    if (token) {
      const prefs = usePrefsStore.getState().prefs;
      if (!prefs) {
        await usePrefsStore.getState().initializeDefaults(deviceTimezone());
      }
    }
  }
  // 'undetermined' → user hasn't been asked yet; nothing to sync.

  // TZ resync: only meaningful when we have a prefs row (compares
  // current device TZ against stored).
  const prefs = usePrefsStore.getState().prefs;
  if (prefs) {
    const tz = deviceTimezone();
    if (tz !== prefs.timezone) {
      const ok = await updateTimezone(tz);
      if (ok) {
        await usePrefsStore.getState().setPrefs({ ...prefs, timezone: tz });
      }
    }
  }

  // Heartbeat: always fire (server filters on user_id; no-row → no-op).
  // Tied to the in-progress 24h-active gate.
  await updateLastForegroundedAt();
}
