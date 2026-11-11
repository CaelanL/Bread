// lib-ok: Permanent test that collapsing two translations of one verse never loses a mastered verse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { VerseProgress } from '../../storage';
import { mayBeMissing, onePerReference, planCollapse, planMoves, referenceKey, seedTranslation, type VerseRecord } from '../translation';

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

  it('never lets a soft-deleted row take over an active one', () => {
    assert.deepEqual(planCollapse([
      row('active', 'NIV', learning(['easy', 'medium'])),
      row('mastered', 'ESV', mastered(3), { deleted: true }),
    ], 'NIV'), []);
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
          const after = applyPlan(records, translation);
          for (const before of records.filter((r) => r.progress.hard.completed)) {
            const best = before.progress.engraved?.passCount ?? 0;
            assert.ok(after.some((r) => r.progress.hard.completed && (r.progress.engraved?.passCount ?? 0) >= best),
              'a mastered row with at least as many passes is still held');
          }
        }
      }
    }
  });
});

// What the store does with a plan: losers deleted for good, then the moves.
function applyPlan(records: VerseRecord[], translation: string): VerseRecord[] {
  const gone = new Set(planCollapse(records, translation).flatMap(({ losers }) => losers.map(({ id }) => id)));
  const kept = records.filter(({ id }) => !gone.has(id)).map((r) => ({ ...r }));
  for (const { id, version } of planMoves(kept, translation)) kept.find((r) => r.id === id)!.version = version;
  return kept;
}

describe('after a collapse', () => {
  it('a reset verse stays reset when the library syncs again', () => {
    const merged = applyPlan([row('esv', 'ESV', mastered(4)), row('niv', 'NIV', mastered(2))], 'NIV');
    assert.equal(merged.length, 1);
    const reset = merged.map((r) => ({ ...r, progress: learning() }));
    const synced = applyPlan(reset, 'NIV');
    assert.deepEqual(synced.map((r) => [r.id, r.progress.hard.completed]), [['esv', false]]);
  });

  it('leaves one row per reference and version, which is what older app versions look up', () => {
    const libraries: VerseRecord[][] = [
      [row('esv', 'ESV', mastered(4)), row('niv', 'NIV', learning())],
      [row('esv', 'ESV', learning()), row('niv', 'NIV', mastered(2), { deleted: true })],
      [row('esv', 'ESV', mastered(1), { deleted: true }), row('kjv', 'KJV', learning(), { deleted: true }), row('niv', 'NIV', learning())],
      [row('a', 'ESV', learning()), row('b', 'NIV', learning()), row('c', 'KJV', mastered(1), { deleted: true })],
    ];
    for (const library of libraries) {
      for (const translation of ['ESV', 'NIV', 'KJV']) {
        const after = applyPlan(library, translation);
        const keys = after.map((r) => `${referenceKey(r)} ${r.version}`);
        assert.equal(new Set(keys).size, keys.length, `one row per reference and version (${translation})`);
        assert.equal(after.filter((r) => !r.deleted).length, Math.min(1, library.filter((r) => !r.deleted).length));
        const shown = after.find((r) => !r.deleted) ?? after[0];
        assert.equal(shown.version, translation, 'the held row is in the account translation');
      }
    }
  });

  it('keeps a verse the translation leaves out in its version', () => {
    const omitted = row('mark', 'KJV', learning(), { book: 'Mark', chapter: 9, verseStart: 44, verseEnd: 44 });
    assert.deepEqual(planMoves([omitted], 'NIV', mayBeMissing), []);
  });
});

describe('seedTranslation', () => {
  const known = (value: string): value is string => ['ESV', 'NIV', 'KJV'].includes(value);
  it('takes the version most active verses are in', () => {
    const records = [row('a', 'KJV', learning()), row('b', 'KJV', learning()), row('c', 'ESV', learning()), row('d', 'NIV', learning(), { deleted: true })];
    assert.equal(seedTranslation(records, 'ESV', known), 'KJV');
  });
  it('falls back to the device choice with no active verses', () => {
    assert.equal(seedTranslation([row('a', 'KJV', learning(), { deleted: true })], 'NIV', known), 'NIV');
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
