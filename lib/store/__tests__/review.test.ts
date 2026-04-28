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
  it('returns now + N*24h exactly', () => {
    const now = new Date(2026, 3, 28, 14, 30, 0);
    const out = nextDueAfterDays(now, 1);
    const parsed = new Date(out);
    assert.equal(parsed.getTime() - now.getTime(), MS_PER_DAY);
  });

  it('handles fractional days irrelevantly (only whole-day callers)', () => {
    const now = new Date(2026, 3, 28, 23, 0, 0);
    const out = nextDueAfterDays(now, 2);
    const parsed = new Date(out);
    assert.equal(parsed.getTime() - now.getTime(), 2 * MS_PER_DAY);
  });
});

describe('computeNextSrState', () => {
  const now = new Date(2026, 3, 28, 12, 0, 0);

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

  it('renders <= 0 as "now"', () => {
    assert.equal(formatTimeUntilDue(0), 'now');
    assert.equal(formatTimeUntilDue(-1), 'now');
    assert.equal(formatTimeUntilDue(-100 * DAY), 'now');
  });

  it('renders sub-minute as "<1 min"', () => {
    assert.equal(formatTimeUntilDue(1), '<1 min');
    assert.equal(formatTimeUntilDue(MIN - 1), '<1 min');
  });

  it('renders 1m to <1h as "X min"', () => {
    assert.equal(formatTimeUntilDue(MIN), '1 min');
    assert.equal(formatTimeUntilDue(15 * MIN), '15 min');
    assert.equal(formatTimeUntilDue(59 * MIN), '59 min');
    assert.equal(formatTimeUntilDue(HOUR - 1), '59 min');
  });

  it('renders 1h to <24h as "Xh"', () => {
    assert.equal(formatTimeUntilDue(HOUR), '1h');
    assert.equal(formatTimeUntilDue(5 * HOUR), '5h');
    assert.equal(formatTimeUntilDue(23 * HOUR), '23h');
    assert.equal(formatTimeUntilDue(DAY - 1), '23h');
  });

  it('renders exact day boundaries as "Xd" with no hour part', () => {
    assert.equal(formatTimeUntilDue(DAY), '1d');
    assert.equal(formatTimeUntilDue(2 * DAY), '2d');
    assert.equal(formatTimeUntilDue(7 * DAY), '7d');
    assert.equal(formatTimeUntilDue(30 * DAY), '30d');
  });

  it('renders day+hour combos with non-zero hour part', () => {
    assert.equal(formatTimeUntilDue(DAY + HOUR), '1d 1h');
    assert.equal(formatTimeUntilDue(DAY + 5 * HOUR), '1d 5h');
    assert.equal(formatTimeUntilDue(2 * DAY + 23 * HOUR), '2d 23h');
    assert.equal(formatTimeUntilDue(3 * DAY + HOUR), '3d 1h');
  });

  it('crisp transitions at the day boundary', () => {
    // Exactly 72h → "3d"
    assert.equal(formatTimeUntilDue(3 * DAY), '3d');
    // 1 second under 72h → "2d 23h" (no overlap with the previous label)
    assert.equal(formatTimeUntilDue(3 * DAY - 1), '2d 23h');
    // 1 second under 24h → "23h" (drops day part entirely)
    assert.equal(formatTimeUntilDue(DAY - 1), '23h');
  });

  it('floors sub-hour minutes (does not round up)', () => {
    // 30m + 59s should still render as "30 min", not "31 min"
    assert.equal(formatTimeUntilDue(30 * MIN + 59_000), '30 min');
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
