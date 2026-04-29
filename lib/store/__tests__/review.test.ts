/**
 * Unit tests for SR pure logic. Run with:
 *
 *   npx tsx --test lib/store/__tests__/review.test.ts
 *
 * Uses Node's built-in `node:test` runner. `tsx` handles TS path resolution
 * (extensionless imports + tsconfig paths). No devDep added — `tsx` is
 * fetched on demand via npx.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { EngravedProgress, SavedVerse } from '../../storage';
import {
  computeNextSrState,
  daysUntilDue,
  dueVersesFor,
  formatTimeUntilDue,
  isDueForReview,
  lockedVersesFor,
  nextDueAfterDays,
} from '../review';
import { ENGRAVED_THRESHOLD } from '../review-config';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const baseEngraved: EngravedProgress = {
  completed: false,
  passCount: 0,
  lifetimeReviews: 0,
  nextDueAt: null,
  lastReviewedAt: null,
  months: [],
};

function makeVerse(engraved: EngravedProgress, hardCompleted = true): SavedVerse {
  return {
    id: 'v1',
    collectionId: 'c1',
    book: 'John',
    chapter: 3,
    verseStart: 16,
    verseEnd: 16,
    version: 'ESV',
    createdAt: 0,
    progress: {
      easy: { bestAccuracy: null, completed: false },
      medium: { bestAccuracy: null, completed: false },
      hard: { bestAccuracy: hardCompleted ? 95 : null, completed: hardCompleted },
      engraved,
    },
  };
}

describe('nextDueAfterDays', () => {
  it('snaps to local midnight of the target calendar day', () => {
    const now = new Date(2026, 3, 28, 14, 30, 0); // April 28 2026, 2:30 PM local
    const out = nextDueAfterDays(now, 1);
    const parsed = new Date(out);
    assert.equal(parsed.getHours(), 0);
    assert.equal(parsed.getMinutes(), 0);
    assert.equal(parsed.getSeconds(), 0);
    assert.equal(parsed.getMilliseconds(), 0);
    // April 29 2026 (one calendar day after April 28).
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 3);
    assert.equal(parsed.getDate(), 29);
  });

  it('snaps regardless of starting time-of-day (11 PM start)', () => {
    const now = new Date(2026, 3, 28, 23, 0, 0); // April 28 2026, 11:00 PM local
    const out = nextDueAfterDays(now, 2);
    const parsed = new Date(out);
    assert.equal(parsed.getHours(), 0);
    // 2 calendar days after April 28 = April 30.
    assert.equal(parsed.getDate(), 30);
  });

  it('snaps regardless of starting time-of-day (12 AM start)', () => {
    const now = new Date(2026, 3, 28, 0, 0, 0); // exactly midnight
    const out = nextDueAfterDays(now, 1);
    const parsed = new Date(out);
    assert.equal(parsed.getHours(), 0);
    assert.equal(parsed.getDate(), 29);
  });

  // DST regression tests: a naive `now.getTime() + N*MS_PER_DAY`
  // hop interacts badly with `setHours(0,0,0,0)` on the 23h
  // spring-forward day (skips a calendar day) and the 25h fall-back
  // day (lands BEFORE now). Asserting calendar-day arithmetic on
  // the result catches both, regardless of the runner's TZ — the
  // test exercises the function's contract ("N calendar days
  // after"), not a fixed-ms delta.
  it('advances by N calendar days, not N*86400 seconds (spring-forward)', () => {
    // Sat March 7 2026, 11:30 PM. US spring-forward: Sun March 8.
    const now = new Date(2026, 2, 7, 23, 30, 0);
    const out = nextDueAfterDays(now, 1);
    const parsed = new Date(out);
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 2);   // March
    assert.equal(parsed.getDate(), 8);    // Sunday — not Monday the 9th
    assert.equal(parsed.getHours(), 0);
  });

  it('advances by N calendar days, not N*86400 seconds (fall-back)', () => {
    // Sun Nov 1 2026, 00:30 AM. US fall-back happens at 2 AM that day.
    const now = new Date(2026, 10, 1, 0, 30, 0);
    const out = nextDueAfterDays(now, 1);
    const parsed = new Date(out);
    // Result must be Nov 2 midnight, NOT earlier than now.
    assert.equal(parsed.getMonth(), 10);
    assert.equal(parsed.getDate(), 2);
    assert.equal(parsed.getHours(), 0);
    assert.ok(parsed.getTime() > now.getTime(), 'next-due must be in the future');
  });
});

describe('computeNextSrState', () => {
  // Midnight local so `now + N days` snapped to midnight equals
  // exactly `now + N * MS_PER_DAY`. Lets the delta assertions below
  // remain crisp — the snap behavior is exercised in the
  // `nextDueAfterDays` block.
  const now = new Date(2026, 3, 28, 0, 0, 0);

  it('does nothing for non-Hard sessions', () => {
    const out = computeNextSrState(baseEngraved, 95, 'easy', true, now, 90);
    assert.deepEqual(out, baseEngraved);
  });

  it('does nothing for sub-90 Hard sessions', () => {
    const out = computeNextSrState(baseEngraved, 89, 'hard', true, now, 90);
    assert.deepEqual(out, baseEngraved);
  });

  it('does nothing for partial sessions', () => {
    const out = computeNextSrState(baseEngraved, 95, 'hard', false, now, 90);
    assert.deepEqual(out, baseEngraved);
  });

  it('initializes SR on first qualifying review (next due exactly 24h later)', () => {
    const out = computeNextSrState(baseEngraved, 95, 'hard', true, now, 90);
    assert.equal(out.passCount, 1);
    assert.equal(out.lifetimeReviews, 1);
    assert.equal(out.completed, false);
    assert.ok(out.nextDueAt);
    assert.ok(out.lastReviewedAt);
    const due = new Date(out.nextDueAt!);
    assert.equal(due.getTime() - now.getTime(), MS_PER_DAY);
  });

  it('advances passCount on on-time review (next due = passCount * 24h from now)', () => {
    // Yesterday's review scheduled today at the same time.
    const yesterday = new Date(now.getTime() - MS_PER_DAY);
    const due = nextDueAfterDays(yesterday, 1);
    const prev: EngravedProgress = { ...baseEngraved, passCount: 1, lifetimeReviews: 1, nextDueAt: due };
    const out = computeNextSrState(prev, 95, 'hard', true, now, 90);
    assert.equal(out.passCount, 2);
    assert.equal(out.lifetimeReviews, 2);
    const next = new Date(out.nextDueAt!);
    assert.equal(next.getTime() - now.getTime(), 2 * MS_PER_DAY);
  });

  it('does not advance passCount on early review (locked)', () => {
    // Due tomorrow, but reviewing today.
    const due = nextDueAfterDays(now, 1);
    const prev: EngravedProgress = { ...baseEngraved, passCount: 5, lifetimeReviews: 5, nextDueAt: due };
    const out = computeNextSrState(prev, 95, 'hard', true, now, 90);
    assert.equal(out.passCount, 5); // unchanged
    assert.equal(out.lifetimeReviews, 6); // ticks
    assert.equal(out.nextDueAt, due); // unchanged
    assert.ok(out.lastReviewedAt);
  });

  it('caps interval at maxIntervalDays', () => {
    // passCount currently 50, cap at 30 → next interval should be exactly 30 days.
    const due = new Date(now.getTime() - MS_PER_DAY).toISOString();
    const prev: EngravedProgress = {
      ...baseEngraved,
      passCount: 50,
      lifetimeReviews: 50,
      completed: true,
      nextDueAt: due,
    };
    const out = computeNextSrState(prev, 95, 'hard', true, now, 30);
    const next = new Date(out.nextDueAt!);
    assert.equal(next.getTime() - now.getTime(), 30 * MS_PER_DAY);
  });

  it('flips completed once passCount hits ENGRAVED_THRESHOLD', () => {
    const due = new Date(now.getTime() - MS_PER_DAY).toISOString();
    const prev: EngravedProgress = {
      ...baseEngraved,
      passCount: ENGRAVED_THRESHOLD - 1,
      lifetimeReviews: ENGRAVED_THRESHOLD - 1,
      nextDueAt: due,
    };
    const out = computeNextSrState(prev, 95, 'hard', true, now, 90);
    assert.equal(out.passCount, ENGRAVED_THRESHOLD);
    assert.equal(out.completed, true);
  });

  it('keeps completed=true once earned, even if state somehow regresses', () => {
    const due = nextDueAfterDays(now, 1); // future, locked
    const prev: EngravedProgress = {
      ...baseEngraved,
      passCount: 3,
      lifetimeReviews: 3,
      completed: true, // already engraved on prior pass
      nextDueAt: due,
    };
    const out = computeNextSrState(prev, 95, 'hard', true, now, 90);
    assert.equal(out.completed, true);
  });

  it('floors a corrupt cap (0/NaN/negative) at 1 day', () => {
    const out = computeNextSrState(baseEngraved, 95, 'hard', true, now, 0);
    const due = new Date(out.nextDueAt!);
    assert.equal(due.getTime() - now.getTime(), MS_PER_DAY);
  });
});

describe('isDueForReview / daysUntilDue', () => {
  const now = new Date(2026, 3, 28, 12, 0, 0);

  it('returns false for unmastered verses', () => {
    const v = makeVerse(baseEngraved, false);
    assert.equal(isDueForReview(v, now), false);
  });

  it('treats mastered + nextDueAt=null as due (legacy migrated row)', () => {
    const v = makeVerse({ ...baseEngraved, passCount: 4, lifetimeReviews: 4 }, true);
    assert.equal(isDueForReview(v, now), true);
    assert.equal(daysUntilDue(v, now), 0);
  });

  it('returns true when nextDueAt has passed', () => {
    const past = new Date(now.getTime() - 2 * MS_PER_DAY).toISOString();
    const v = makeVerse({ ...baseEngraved, passCount: 1, nextDueAt: past }, true);
    assert.equal(isDueForReview(v, now), true);
  });

  it('returns false when nextDueAt is in the future', () => {
    const future = nextDueAfterDays(now, 5);
    const v = makeVerse({ ...baseEngraved, passCount: 1, nextDueAt: future }, true);
    assert.equal(isDueForReview(v, now), false);
    assert.equal(daysUntilDue(v, now), 5);
  });
});

describe('formatTimeUntilDue', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('renders any sub-day amount as "tmr"', () => {
    // Under midnight-snap, anything < 24h means due tomorrow morning.
    assert.equal(formatTimeUntilDue(1), 'tmr');
    assert.equal(formatTimeUntilDue(30 * MIN), 'tmr');
    assert.equal(formatTimeUntilDue(5 * HOUR), 'tmr');
    assert.equal(formatTimeUntilDue(23 * HOUR), 'tmr');
    assert.equal(formatTimeUntilDue(DAY - 1), 'tmr');
  });

  it('renders 1d–3d exact-day boundaries with no hour part', () => {
    assert.equal(formatTimeUntilDue(DAY), '1d');
    assert.equal(formatTimeUntilDue(2 * DAY), '2d');
    assert.equal(formatTimeUntilDue(3 * DAY), '3d');
  });

  it('renders 1d–3d day+hour combos with hour part', () => {
    assert.equal(formatTimeUntilDue(DAY + HOUR), '1d 1h');
    assert.equal(formatTimeUntilDue(DAY + 5 * HOUR), '1d 5h');
    assert.equal(formatTimeUntilDue(2 * DAY + 23 * HOUR), '2d 23h');
    assert.equal(formatTimeUntilDue(3 * DAY + HOUR), '3d 1h');
  });

  it('drops hour part at >= 4 days', () => {
    assert.equal(formatTimeUntilDue(4 * DAY), '4d');
    assert.equal(formatTimeUntilDue(4 * DAY + 5 * HOUR), '4d');
    assert.equal(formatTimeUntilDue(4 * DAY + 23 * HOUR), '4d');
    assert.equal(formatTimeUntilDue(7 * DAY), '7d');
    assert.equal(formatTimeUntilDue(30 * DAY + 12 * HOUR), '30d');
  });

  it('crisp transitions at boundaries', () => {
    // Just under 24h → "tmr"; exactly 24h → "1d".
    assert.equal(formatTimeUntilDue(DAY - 1), 'tmr');
    assert.equal(formatTimeUntilDue(DAY), '1d');
    // 4d threshold flips off the hour part.
    assert.equal(formatTimeUntilDue(3 * DAY + 23 * HOUR), '3d 23h');
    assert.equal(formatTimeUntilDue(4 * DAY - 1), '3d 23h');
    assert.equal(formatTimeUntilDue(4 * DAY), '4d');
  });
});

describe('dueVersesFor / lockedVersesFor', () => {
  const now = new Date(2026, 3, 28, 12, 0, 0);

  it('partitions a list correctly', () => {
    const past = new Date(now.getTime() - 2 * MS_PER_DAY).toISOString();
    const future = nextDueAfterDays(now, 5);
    const dueVerse = makeVerse({ ...baseEngraved, passCount: 1, nextDueAt: past }, true);
    const lockedVerse = { ...makeVerse({ ...baseEngraved, passCount: 1, nextDueAt: future }, true), id: 'v2' };
    const unmastered = { ...makeVerse(baseEngraved, false), id: 'v3' };
    const list = [dueVerse, lockedVerse, unmastered];
    assert.deepEqual(
      dueVersesFor(list, now).map((v) => v.id),
      ['v1'],
    );
    assert.deepEqual(
      lockedVersesFor(list, now).map((v) => v.id),
      ['v2'],
    );
  });
});
