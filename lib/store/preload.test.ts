// lib-ok: unit tests for the verse text preload picker.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { SavedVerse } from '../storage';
import { pickPreload } from './preload';

function verse(id: string, fields: Partial<SavedVerse> = {}): SavedVerse {
  return {
    id,
    collectionId: 'c1',
    book: 'John',
    chapter: 3,
    verseStart: Number(id.replace(/\D/g, '')) || 1,
    verseEnd: Number(id.replace(/\D/g, '')) || 1,
    version: 'ESV',
    createdAt: 0,
    progress: { easy: { bestAccuracy: null, completed: false }, medium: { bestAccuracy: null, completed: false }, hard: { bestAccuracy: null, completed: false } },
    ...fields,
  };
}

const ids = (verses: SavedVerse[]) => verses.map((v) => v.id);

test('Hide verses on: nothing to preload', () => {
  assert.deepEqual(pickPreload([verse('v1'), verse('v2')], { hideVerseText: true }), []);
});

test('KJV is skipped', () => {
  assert.deepEqual(ids(pickPreload([verse('v1', { version: 'KJV' }), verse('v2')], { hideVerseText: false })), ['v2']);
});

test('a verse in several collections is preloaded once', () => {
  const picked = pickPreload(
    [verse('v1', { collectionId: 'a' }), verse('v1', { collectionId: 'b' }), verse('v2')],
    { hideVerseText: false },
  );
  assert.deepEqual(ids(picked), ['v1', 'v2']);
});

test('the same reference in another translation is its own entry', () => {
  const picked = pickPreload([verse('v1'), verse('v1', { version: 'NIV' })], { hideVerseText: false });
  assert.deepEqual(picked.map((v) => v.version), ['ESV', 'NIV']);
});

test('most recently practiced first, never practiced last, then newest', () => {
  const picked = pickPreload(
    [
      verse('v1', { createdAt: 1 }),
      verse('v2', { lastPracticedAt: '2026-11-01T00:00:00.000Z' }),
      verse('v3', { createdAt: 3 }),
      verse('v4', { lastPracticedAt: '2026-11-10T00:00:00.000Z' }),
    ],
    { hideVerseText: false },
  );
  assert.deepEqual(ids(picked), ['v4', 'v2', 'v3', 'v1']);
});
