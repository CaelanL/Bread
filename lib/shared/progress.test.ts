// lib-ok: Unit tests for the shared collection progress grid.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGrid,
  cellState,
  everyoneEngraved,
  everyoneMastered,
  groupProgress,
  masteredByEveryoneCount,
  openVersesFor,
  progressFlags,
  replaceMemberCells,
  type ProgressCell,
  type SharedReference,
} from './progress';

const r828: SharedReference = { book: 'Romans', chapter: 8, verseStart: 28, verseEnd: 28 };
const r81: SharedReference = { book: 'Romans', chapter: 8, verseStart: 1, verseEnd: 1 };
const r838: SharedReference = { book: 'Romans', chapter: 8, verseStart: 38, verseEnd: 39 };
const none = { practiced: false, mastered: false, engraved: false };
const learning = { practiced: true, mastered: false, engraved: false };
const mastered = { practiced: true, mastered: true, engraved: false };
const engraved = { practiced: true, mastered: true, engraved: true };
const cell = (userId: string, ref: SharedReference, flags: typeof none): ProgressCell => ({ userId, ...ref, ...flags });

test('a square is Engraved over Mastered over Learning over Open', () => {
  assert.equal(cellState(none), 'open');
  assert.equal(cellState(learning), 'learning');
  assert.equal(cellState(mastered), 'mastered');
  assert.equal(cellState(engraved), 'engraved');
  assert.equal(cellState({ practiced: false, mastered: false, engraved: true }), 'engraved');
});

test('Due and Locked verses count as Mastered: only hard.completed decides', () => {
  const due = { easy: { bestAccuracy: 95 }, medium: { bestAccuracy: null }, hard: { bestAccuracy: 92, completed: true },
    engraved: { completed: false, nextDueAt: null } };
  const locked = { ...due, engraved: { completed: false, nextDueAt: '2999-01-01T00:00:00.000Z' } };
  assert.equal(cellState(progressFlags(due)), 'mastered');
  assert.equal(cellState(progressFlags(locked)), 'mastered');
  const fresh = { easy: { bestAccuracy: null }, medium: { bestAccuracy: null }, hard: { bestAccuracy: null, completed: false } };
  assert.equal(cellState(progressFlags(fresh)), 'open');
  assert.equal(cellState(progressFlags({ ...fresh, medium: { bestAccuracy: 40 } })), 'learning');
});

// The seed: Cara and Dana engraved 8:1, Cara mastered 8:28 and Dana is learning it, no one started 8:38-39.
const seed = buildGrid(['C', 'D'], [r81, r828, r838], [
  cell('C', r81, engraved), cell('C', r828, mastered),
  cell('D', r81, engraved), cell('D', r828, learning),
]);

test('a verse no one has started is Open for everyone', () => {
  assert.deepEqual(seed.rows[2].states, ['open', 'open']);
  assert.equal(seed.rows[2].masteredCount, 0);
});

test('the group count per verse counts mastered and engraved members', () => {
  assert.deepEqual(seed.rows.map((row) => row.masteredCount), [2, 1, 0]);
  assert.deepEqual(seed.rows[1].states, ['mastered', 'learning']);
});

test('group progress is mastered squares over all squares', () => {
  assert.equal(groupProgress(seed), 3 / 6);
  assert.equal(masteredByEveryoneCount(seed), 1);
  assert.equal(everyoneMastered(seed), false);
  assert.equal(everyoneEngraved(seed), false);
});

test('a member with no copy yet has an Open square on every verse', () => {
  const grid = buildGrid(['C', 'D', 'E'], [r81, r828, r838], [cell('C', r81, mastered)]);
  assert.deepEqual(grid.rows.map((row) => row.states[2]), ['open', 'open', 'open']);
  assert.equal(groupProgress(grid), 1 / 9);
  assert.deepEqual(openVersesFor('E', grid), [r81, r828, r838]);
});

test('everyone mastered, and everyone engraved', () => {
  const allMastered = buildGrid(['C', 'D'], [r81, r828], [
    cell('C', r81, engraved), cell('C', r828, mastered), cell('D', r81, mastered), cell('D', r828, engraved),
  ]);
  assert.equal(everyoneMastered(allMastered), true);
  assert.equal(everyoneEngraved(allMastered), false);
  assert.equal(groupProgress(allMastered), 1);

  const allEngraved = buildGrid(['C', 'D'], [r81, r828], [
    cell('C', r81, engraved), cell('C', r828, engraved), cell('D', r81, engraved), cell('D', r828, engraved),
  ]);
  assert.equal(everyoneMastered(allEngraved), true);
  assert.equal(everyoneEngraved(allEngraved), true);
});

test('an empty grid is 0% and never everyone-done', () => {
  for (const grid of [buildGrid([], [r81], []), buildGrid(['C'], [], [])]) {
    assert.equal(groupProgress(grid), 0);
    assert.equal(everyoneMastered(grid), false);
    assert.equal(everyoneEngraved(grid), false);
  }
});

test('open verses are the ones a member has not mastered, in grid order', () => {
  assert.deepEqual(openVersesFor('C', seed), [r838]);
  assert.deepEqual(openVersesFor('D', seed), [r828, r838]);
  assert.deepEqual(openVersesFor('stranger', seed), []);
});

test('ranges match exactly, and cells for other verses or non-members are ignored', () => {
  const r82830 = { ...r828, verseEnd: 30 };
  const grid = buildGrid(['C'], [r828], [cell('C', r82830, mastered), cell('X', r828, mastered)]);
  assert.deepEqual(grid.rows[0].states, ['open']);
});

test('several rows for one square fold with OR, like the server', () => {
  const grid = buildGrid(['C'], [r828], [cell('C', r828, learning), cell('C', r828, { ...none, mastered: true })]);
  assert.deepEqual(grid.rows[0].states, ['mastered']);
});

test("a member's own squares can be swapped for their local verses", () => {
  const server = [cell('C', r828, mastered), cell('C', r81, learning), cell('D', r828, mastered)];
  const swapped = replaceMemberCells(server, 'C', [cell('C', r828, none)]);
  const grid = buildGrid(['C', 'D'], [r81, r828], swapped);
  assert.deepEqual(grid.rows.map((row) => row.states), [['learning', 'open'], ['open', 'mastered']]);
});
