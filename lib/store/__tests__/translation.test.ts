// lib-ok: Permanent test that collapsing two translations of one verse never loses a mastered verse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { VerseProgress } from '../../storage';
import { mayBeMissing, onePerReference, planCollapse, type VerseRecord } from '../translation';

const learning = (completed: ('easy' | 'medium' | 'hard')[] = []): VerseProgress => ({
  easy: { bestAccuracy: completed.includes('easy') ? 95 : 60, completed: completed.includes('easy') },
  medium: { bestAccuracy: completed.includes('medium') ? 95 : null, completed: completed.includes('medium') },
  hard: { bestAccuracy: completed.includes('hard') ? 95 : null, completed: completed.includes('hard') },
});

const mastered = (passCount: number): VerseProgress => ({
  ...learning(['easy', 'medium', 'hard']),
  engraved: { completed: passCount >= 10, passCount, lifetimeReviews: passCount, nextDueAt: null, lastReviewedAt: null },
});

function row(id: string, version: string, progress: VerseProgress, extra: Partial<VerseRecord> = {}): VerseRecord {
  return { id, book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, version, progress, deleted: false, ...extra };
}

describe('planCollapse', () => {
  it('keeps the mastered row over a learning row in the account translation', () => {
    const [plan] = planCollapse([row('niv', 'NIV', learning(['easy', 'medium'])), row('esv', 'ESV', mastered(1))], 'NIV');
    assert.equal(plan.winner.id, 'esv');
    assert.deepEqual(plan.losers.map((r) => r.id), ['niv']);
  });

  it('keeps a soft-deleted mastered row over an active learning row', () => {
    const [plan] = planCollapse([
      row('active', 'NIV', learning(['easy', 'medium'])),
      row('mastered', 'ESV', mastered(3), { deleted: true }),
    ], 'NIV');
    assert.equal(plan.winner.id, 'mastered');
  });

  it('prefers the higher passCount when both are mastered', () => {
    const [plan] = planCollapse([row('a', 'ESV', mastered(2)), row('b', 'NIV', mastered(7))], 'ESV');
    assert.equal(plan.winner.id, 'b');
  });

  it('prefers more completed difficulties when neither is mastered', () => {
    const [plan] = planCollapse([row('a', 'ESV', learning(['easy'])), row('b', 'NIV', learning(['easy', 'medium']))], 'ESV');
    assert.equal(plan.winner.id, 'b');
  });

  it('breaks a tie with the active row in the account translation', () => {
    const [plan] = planCollapse([row('a', 'ESV', learning()), row('b', 'NIV', learning())], 'NIV');
    assert.equal(plan.winner.id, 'b');
  });

  it('leaves different ranges and hidden rows alone', () => {
    assert.deepEqual(planCollapse([
      row('one', 'ESV', learning()),
      row('range', 'NIV', learning(), { verseEnd: 17 }),
      row('gone', 'NIV', learning(), { deleted: true }),
    ], 'ESV'), []);
  });

  it('never loses a mastered verse, whatever the pair', () => {
    const shapes: [VerseProgress, boolean][] = [
      [learning(), false], [learning(['easy']), false], [learning(['easy', 'medium']), true],
      [mastered(1), false], [mastered(1), true], [mastered(10), true], [mastered(4), false],
    ];
    for (const [pa, da] of shapes) {
      for (const [pb, db] of shapes) {
        for (const translation of ['ESV', 'NIV']) {
          const records = [row('a', 'ESV', pa, { deleted: da }), row('b', 'NIV', pb, { deleted: db })];
          const masteredIn = records.filter((r) => r.progress.hard.completed);
          const plans = planCollapse(records, translation);
          if (masteredIn.length === 0) continue;
          const kept = plans.length ? plans[0].winner : masteredIn[0];
          assert.ok(kept.progress.hard.completed, 'a mastered row keeps the reference');
          const best = Math.max(...masteredIn.map((r) => r.progress.engraved?.passCount ?? 0));
          assert.equal(kept.progress.engraved?.passCount, best, 'the most reviewed mastered row is kept');
        }
      }
    }
  });
});

describe('onePerReference', () => {
  it('lists a verse mastered in two translations once, keeping the better row', () => {
    const records = [
      row('esv', 'ESV', mastered(2), { deleted: true }),
      row('niv', 'NIV', mastered(5)),
      row('romans', 'ESV', mastered(1), { book: 'Romans', chapter: 8, verseStart: 28, verseEnd: 28 }),
    ];
    assert.deepEqual(onePerReference(records, 'ESV').map((r) => r.id), ['niv', 'romans']);
  });
});

describe('mayBeMissing', () => {
  it('flags ranges that touch a verse some translations leave out', () => {
    assert.equal(mayBeMissing({ book: 'Mark', chapter: 9, verseStart: 43, verseEnd: 45 }), true);
    assert.equal(mayBeMissing({ book: 'Matthew', chapter: 17, verseStart: 21, verseEnd: 21 }), true);
    assert.equal(mayBeMissing({ book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 }), false);
    assert.equal(mayBeMissing({ book: 'Mark', chapter: 9, verseStart: 47, verseEnd: 50 }), false);
  });
});
