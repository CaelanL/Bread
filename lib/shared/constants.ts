// lib-ok: Shared collection caps, mirrored by private.shared_limits() in SQL.
export const MAX_SHARED_MEMBERS = 30;
export const MAX_SHARED_COLLECTIONS = 20;
export const INVITE_TTL_DAYS = 14;
export const MAX_SHARED_VERSES = 200;

/**
 * Whether Share… on a collection would make one group too many. A collection that already has a
 * group never does: its code and Stop sharing (the way to free a slot) live behind that same Share….
 */
export function shareHitsCap(sharedId: string | undefined, sharedCount: number): boolean {
  return !sharedId && sharedCount >= MAX_SHARED_COLLECTIONS;
}
