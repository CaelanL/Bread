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

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * ISO UTC timestamp of `daysFromNow * 24h` after `now`. Returns the
 * exact moment 1, 2, 3… days later — not aligned to local midnight.
 *
 * Rationale: a review at 11pm with daysFromNow=1 should be due 24
 * hours later (the next 11pm), not just 1 hour later at the next
 * midnight. The user's mental model is "review interval = N days,"
 * and seeing "in 11h" the moment after a review is confusing.
 *
 * The round-7 notification system (see
 * docs/features/notification-system.md) is server-side: a Supabase
 * cron polls every minute and pushes a digest naming verses where
 * `nextDueAt <= now()`. Hour-precise `nextDueAt` is what we want —
 * the digest catches the verse on the next cron pass after it
 * becomes due, regardless of wall-clock alignment.
 */
export function nextDueAfterDays(now: Date, daysFromNow: number): string {
  return new Date(now.getTime() + daysFromNow * HOURS_PER_DAY * MS_PER_HOUR).toISOString();
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
 * Scheme:
 *   - >= 24h: "Xd Yh" (or "Xd" when hours = 0, i.e. exactly N*24h)
 *   - 1h to <24h: "Xh"
 *   - 1m to <1h: "X min"
 *   - <1m: "<1 min"
 *   - <= 0: "now"
 *
 * Boundaries are crisp by design: at exactly 72h shows "3d", and any
 * second after drops to "2d 23h" — no overlap with the day-only label.
 * Days/hours are floored, so "in 1d 5h" stays "in 1d 5h" for the full
 * hour from 29h-down-to-28h-and-1-second.
 */
export function formatTimeUntilDue(diffMs: number): string {
  if (diffMs <= 0) return 'now';
  if (diffMs < 60_000) return '<1 min';

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const totalHours = Math.floor(diffMs / (60 * 60_000));
  if (totalHours < 24) return `${totalHours}h`;

  const days = Math.floor(diffMs / (24 * 60 * 60_000));
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
