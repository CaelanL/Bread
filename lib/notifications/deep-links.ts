/**
 * Notification tap response handler.
 *
 * Registered once from app/_layout.tsx. Maps the push payload's
 * `target` field to an expo-router path. Mastered's default sort is
 * already 'due-first' (lib/store/index.ts:147), so the verses named
 * in the digest body sit at the top of the list when the user lands.
 *
 * Cold-start handling: iOS may launch the app from a tap.
 * `getLastNotificationResponseAsync()` returns the launch payload;
 * we route the same way.
 */

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import {
  IN_PROGRESS_COLLECTION_ID,
  MASTERED_COLLECTION_ID,
} from '@/lib/storage';
import type { NotificationDeepLink } from './types';

function parsePayload(data: unknown): NotificationDeepLink | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const source = d.source;
  const target = d.target;
  if (source !== 'reviews' && source !== 'in-progress') return null;
  if (target !== 'mastered' && target !== 'in-progress') return null;
  return { source, target };
}

function routeTo(target: NotificationDeepLink['target']): void {
  // The library tab nests the dynamic [id] route. Mastered and
  // In-progress are virtual collections served by the same route.
  const id = target === 'mastered' ? MASTERED_COLLECTION_ID : IN_PROGRESS_COLLECTION_ID;
  router.push(`/(tabs)/(library)/${id}`);
}

/**
 * Subscribe to tap responses + handle cold-start. Call once at
 * app boot; returns an unsubscribe.
 *
 * Cold-start (the tap that launched the app) is queued internally
 * until `replayColdStart()` is called from a context that's certain
 * the navigator is mounted and the user is authenticated. This avoids
 * pushing onto an unmounted stack or routing past the auth gate.
 */
let pendingColdStart: NotificationDeepLink | null = null;
let coldStartLoaded = false;

export function registerDeepLinkHandler(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const link = parsePayload(response.notification.request.content.data);
    if (link) routeTo(link.target);
  });

  // Cold-start: app was launched by a tap. Capture it; replay later.
  if (!coldStartLoaded) {
    coldStartLoaded = true;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const link = parsePayload(response.notification.request.content.data);
      if (link) pendingColdStart = link;
    }).catch((err) => {
      console.error('[notifications] getLastNotificationResponseAsync', err);
    });
  }

  return () => sub.remove();
}

/**
 * Replay the cold-start tap (if any). Caller must guarantee the
 * navigator is mounted AND the user is authenticated. Idempotent —
 * subsequent calls are no-ops.
 */
export function replayColdStartTap(): void {
  if (!pendingColdStart) return;
  const link = pendingColdStart;
  pendingColdStart = null;
  routeTo(link.target);
}
