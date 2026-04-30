/**
 * Spaced-repetition review logic — pure functions, no side effects.
 *
 * The algorithm:
 *   - Each `passCount` is the number of consecutive on-time reviews.
 *   - Days to next review = min(passCount, userMaxIntervalDays), counted
 *     from local midnight of the completion day.
 *   - A qualifying review (Hard, ≥ 90%, full session) on or after
 *     `nextDueAt` advances passCount by 1.
 *   - A qualifying review *before* `nextDueAt` only ticks lifetimeReviews;
 *     the schedule and passCount are untouched.
 *   - Engraved is `passCount >= ENGRAVED_THRESHOLD`. Permanent — does not
 *     require ongoing maintenance to retain.
 *   - The schedule keeps growing past the engraving threshold; engraving
 *     is a milestone, not a state change.
 */

import type { Difficulty, EngravedProgress, SavedVerse } from '@/lib/storage';
import { ENGRAVED_THRESHOLD } from './review-config';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * ISO UTC timestamp at local midnight, `daysFromNow` calendar days
 * after `now`.
 *
 * Rationale: the notification system delivers a daily-or-weekly
 * digest at a user-chosen wall-clock time (default 9 AM local). For
 * the digest to *reliably* catch every newly-due verse on its due
 * day, due moments must land at a wall-clock instant the user's
 * digest is guaranteed to fire after — local midnight is the only
 * such moment. A verse mastered at 11:59 PM Tuesday with a 1-day
 * interval becomes due Wednesday 12:00 AM, and any digest the user
 * picks for Wednesday catches it. See
 * docs/features/notification-system.md ("Why the review system
 * change") for the product framing.
 *
 * DST: we advance via `setDate(getDate() + daysFromNow)`, which is
 * calendar-aware. A naive `now.getTime() + daysFromNow * 86400_000`
 * would be a fixed-UTC-ms hop and disagree with `setHours(0,0,0,0)`
 * on DST days (23 or 25 hours long), producing off-by-one-day errors
 * — and on the fall-back day, a `nextDueAt` *earlier than now* for
 * verses mastered in the first hour after midnight. `setDate` always
 * lands on the intended calendar day's midnight regardless.
 *
 * Forward-only: old clients in the wild keep writing hour-precise
 * values until they update. Mixed precision is fine — readers
 * (`isDueForReview`, `daysUntilDue`, `lockedVersesFor`) compare with
 * `>=`/`<` and tolerate either. A verse touched by an old client
 * gets midnight-snapped on its next qualifying review here.
 */
export function nextDueAfterDays(now: Date, daysFromNow: number): string {
  const target = new Date(now);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + daysFromNow);
  return target.toISOString();
}

/**
 * Compute the next SR state from the current state and a session result.
 *
 * Returns the new EngravedProgress. The legacy `months` array is preserved
 * untouched — new clients write only the new fields, but we don't actively
 * strip `months` until the cleanup migration ships.
 */
export function computeNextSrState(
  prev: EngravedProgress,
  finalScore: number,
  difficulty: Difficulty,
  fullSession: boolean,
  now: Date,
  maxIntervalDays: number,
): EngravedProgress {
  const isQualifying = difficulty === 'hard' && finalScore >= 90 && fullSession;

  if (!isQualifying) {
    return prev;
  }

  // Defensive floor: a stale/corrupt cap (0, NaN, negative) would make
  // nextDueAfterDays(now, 0) resolve to right now, leaving the verse
  // perpetually due. Floor at 1 day.
  const safeCap = Number.isFinite(maxIntervalDays) && maxIntervalDays >= 1
    ? maxIntervalDays
    : 1;

  const nowMs = now.getTime();
  const dueMs = prev.nextDueAt ? new Date(prev.nextDueAt).getTime() : null;

  // First-ever qualifying review (no schedule yet).
  if (dueMs === null) {
    const passCount = prev.passCount + 1;
    return {
      ...prev,
      passCount,
      lifetimeReviews: prev.lifetimeReviews + 1,
      lastReviewedAt: now.toISOString(),
      nextDueAt: nextDueAfterDays(now, Math.min(passCount, safeCap)),
      completed: passCount >= ENGRAVED_THRESHOLD || prev.completed,
    };
  }

  // Locked (early). Lifetime ticks; schedule and passCount untouched.
  if (nowMs < dueMs) {
    return {
      ...prev,
      lifetimeReviews: prev.lifetimeReviews + 1,
      lastReviewedAt: now.toISOString(),
    };
  }

  // On-time or overdue.
  const passCount = prev.passCount + 1;
  return {
    ...prev,
    passCount,
    lifetimeReviews: prev.lifetimeReviews + 1,
    lastReviewedAt: now.toISOString(),
    nextDueAt: nextDueAfterDays(now, Math.min(passCount, safeCap)),
    completed: passCount >= ENGRAVED_THRESHOLD || prev.completed,
  };
}

/**
 * Is this verse currently due (or overdue) for a review?
 * A mastered verse with no schedule yet (legacy migrated row) is treated
 * as Due — the first qualifying review will initialize SR.
 */
export function isDueForReview(verse: SavedVerse, now: Date): boolean {
  const e = verse.progress.engraved;
  if (!e || !verse.progress.hard?.completed) return false;
  if (e.nextDueAt === null) return true;
  return now.getTime() >= new Date(e.nextDueAt).getTime();
}

/**
 * Days until the verse is due. 0 = due now / overdue. Negative values are
 * clamped to 0; callers don't need overdue magnitude.
 *
 * For unscheduled mastered verses (`nextDueAt === null`), returns 0 so
 * they sort alongside due verses.
 */
export function daysUntilDue(verse: SavedVerse, now: Date): number {
  const e = verse.progress.engraved;
  if (!e || !verse.progress.hard?.completed) return Infinity;
  if (e.nextDueAt === null) return 0;
  const diffMs = new Date(e.nextDueAt).getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / MS_PER_DAY);
}

/** All verses currently due for review (mastered + on/past nextDueAt). */
export function dueVersesFor(verses: SavedVerse[], now: Date): SavedVerse[] {
  return verses.filter((v) => isDueForReview(v, now));
}

/**
 * Format a positive `diffMs` as a compact "time until" string. Single
 * source of truth for review-state UI labels — used by ReviewStateBadge
 * (verse cards) and ProgressCard (Setup screen) so they never drift.
 *
 * Callers gate on `isDueForReview` first, so this function is never
 * called with `diffMs <= 0`. Defensive `<= 0 → "tmr"` is a non-issue
 * in practice; readers see "Review now" via the badge's due branch.
 *
 * Scheme (post midnight-snap):
 *   - < 24h:        "tmr"   (any sub-day amount — verses always come due
 *                            at local midnight, so anything <24h means
 *                            "due tomorrow morning")
 *   - 1d–3d, exact: "Xd"    (exactly N×24h)
 *   - 1d–3d, +hrs:  "Xd Yh" (with non-zero hour part)
 *   - >= 4d:        "Xd"    (drop hour part — at this range hours are noise)
 */
export function formatTimeUntilDue(diffMs: number): string {
  if (diffMs < 24 * 60 * 60_000) return 'tmr';

  const totalHours = Math.floor(diffMs / (60 * 60_000));
  const days = Math.floor(diffMs / (24 * 60 * 60_000));
  if (days >= 4) return `${days}d`;
  const hours = totalHours - days * 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/** All verses that are mastered but locked (scheduled in the future). */
export function lockedVersesFor(verses: SavedVerse[], now: Date): SavedVerse[] {
  return verses.filter((v) => {
    const e = v.progress.engraved;
    if (!e || !v.progress.hard?.completed) return false;
    if (e.nextDueAt === null) return false;
    return now.getTime() < new Date(e.nextDueAt).getTime();
  });
}
