// lib-ok: unit tests for the library snapshot's allowlist and checks.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Collection, SavedVerse, SharedCollectionInfo } from '../storage';
import { parseSnapshot, serializeSnapshot, SNAPSHOT_MAX_AGE_MS } from './snapshot';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const verse: SavedVerse = {
  id: 'v1',
  collectionId: 'c1',
  book: 'John',
  chapter: 3,
  verseStart: 16,
  verseEnd: 17,
  version: 'ESV',
  createdAt: 1,
  progress: {
    easy: { bestAccuracy: 100, completed: true },
    medium: { bestAccuracy: 92, completed: true },
    hard: { bestAccuracy: 40, completed: false },
  },
  lastPracticedAt: '2026-11-13T10:00:00Z',
  lastChunkSize: 2,
  lastDifficulty: 'hard',
  updatedAt: '2026-11-13T10:00:00.123456+00:00',
};
const collections: Collection[] = [
  { id: 'my-verses', name: 'My Verses', isDefault: true, createdAt: 0 },
  { id: 'mastered', name: 'Mastered', isDefault: false, isVirtual: true, icon: 'checkmark.circle.fill', iconColor: '#22c55e', createdAt: 0 },
  { id: 'c1', name: 'Romans 8', isDefault: false, createdAt: 5, sortPreference: 'alphabetical', sharedId: 'g1', iconKey: 'heart' as Collection['iconKey'] },
];
const shared: SharedCollectionInfo = {
  id: 'g1', ownerName: 'Cara L.', name: 'Romans 8', role: 'member', memberCount: 3, verseCount: 4, masteredSquares: 1, engravedSquares: 0,
};
const state = {
  collections,
  verses: [verse],
  masteredVerses: [{ ...verse, collectionId: 'mastered' }],
  sharedCollections: { g1: shared },
  displayName: 'Dana D.',
  firstName: 'Dana',
  lastName: 'Doe',
};

test('verse text never reaches the snapshot (invariant 2)', () => {
  const withText = { ...verse, text: 'For God so loved', verses: { 16: 'For God so loved', 17: 'For God did not send' } };
  const json = serializeSnapshot({ ...state, verses: [withText], masteredVerses: [withText] }, NOW);
  assert.equal(json.includes('"text"'), false);
  assert.equal(json.includes('"verses":{'), false);
  assert.equal(json.includes('For God'), false);
  const parsed = parseSnapshot(json, NOW)!;
  for (const v of [...parsed.verses, ...parsed.masteredVerses]) {
    assert.equal('text' in v, false);
    assert.equal('verses' in v, false);
  }
});

test('a snapshot carrying text on disk drops it when read', () => {
  const json = JSON.parse(serializeSnapshot(state, NOW));
  json.verses[0].text = 'For God so loved';
  const parsed = parseSnapshot(JSON.stringify(json), NOW)!;
  assert.equal('text' in parsed.verses[0], false);
});

test('a round trip keeps every allowlisted field, owner names and the user\'s name; virtual collections stay out', () => {
  const parsed = parseSnapshot(serializeSnapshot(state, NOW), NOW)!;
  assert.deepEqual(parsed.verses, [verse]);
  assert.deepEqual(parsed.masteredVerses, [{ ...verse, collectionId: 'mastered' }]);
  assert.deepEqual(parsed.collections.map((c) => c.id), ['my-verses', 'c1']);
  assert.deepEqual(parsed.collections[1], collections[2]);
  assert.deepEqual(parsed.sharedCollections, { g1: shared });
  assert.deepEqual(parsed.names, { displayName: 'Dana D.', firstName: 'Dana', lastName: 'Doe' });
});

test('too old, another format version and broken values are rejected', () => {
  assert.equal(parseSnapshot(serializeSnapshot(state, NOW - 8 * DAY), NOW), null);
  assert.ok(parseSnapshot(serializeSnapshot(state, NOW - SNAPSHOT_MAX_AGE_MS + 1000), NOW));
  assert.equal(parseSnapshot(JSON.stringify({ ...JSON.parse(serializeSnapshot(state, NOW)), v: 2 }), NOW), null);
  assert.equal(parseSnapshot('{"v":1,', NOW), null);
  assert.equal(parseSnapshot(null, NOW), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...JSON.parse(serializeSnapshot(state, NOW)), verses: [{ id: 'v1' }] }), NOW), null);
});
