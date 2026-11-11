// lib-ok: Catalog integrity tests catch invalid references and licensed text in bundled data.
import assert from 'node:assert/strict';
import test from 'node:test';

import { VERSE_COUNTS } from '../../supabase/functions/bible/verse-counts';
import { CURATED_COLLECTIONS } from './catalog';
import { curatedCollectionId } from './identity';
import { COLLECTION_ICONS, collectionSymbolFallback, isCollectionIconKey, resolveCollectionIcon } from './icons';

test('curated collections contain distinct, short canonical references and original introductions', () => {
  assert.equal(CURATED_COLLECTIONS.length, 10);
  assert.equal(new Set(CURATED_COLLECTIONS.map(({ id }) => id)).size, 10);

  for (const collection of CURATED_COLLECTIONS) {
    assert.match(collection.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(isCollectionIconKey(collection.icon), collection.id);
    const words = collection.introduction.split(/\s+/).length;
    assert.ok(words >= 100 && words <= 200, collection.id);
    assert.equal(collection.passages.length, 12, collection.id);

    const seen = new Set<string>();
    for (const passage of collection.passages) {
      const { book, chapter, verseStart, verseEnd } = passage;
      const verseCount = VERSE_COUNTS[book]?.[chapter - 1];
      const label = `${book} ${chapter}:${verseStart}–${verseEnd}`;
      assert.ok(Number.isInteger(chapter) && verseCount, label);
      assert.ok(Number.isInteger(verseStart) && verseStart > 0, label);
      assert.ok(Number.isInteger(verseEnd) && verseEnd <= verseCount, label);
      assert.ok(verseEnd - verseStart === 0 || verseEnd - verseStart === 1, label);
      assert.ok(!seen.has(label), `${collection.id}: ${label}`);
      assert.deepEqual(Object.keys(passage).sort(), ['book', 'chapter', 'verseEnd', 'verseStart']);
      seen.add(label);
    }
  }
});

test('missing or unfamiliar icon keys use the default collection icon', () => {
  assert.equal(Object.keys(COLLECTION_ICONS).length, 36);
  assert.equal(resolveCollectionIcon('shield'), COLLECTION_ICONS.shield);
  for (const key of [undefined, null, '', 'future-icon', 'constructor']) {
    assert.equal(resolveCollectionIcon(key), COLLECTION_ICONS.book);
  }
});

test('older supported iOS releases have a fallback for newer collection symbols', () => {
  assert.equal(collectionSymbolFallback('mountain.2', 15.1), 'terrain');
  assert.equal(collectionSymbolFallback('mountain.2', 16), 'terrain');
  assert.equal(collectionSymbolFallback('mountain.2', 16.1), undefined);
  assert.equal(collectionSymbolFallback('book.closed', 15.1), undefined);
});

test('import IDs stay stable and distinguish translations', () => {
  assert.equal(curatedCollectionId('anxiety-and-peace', 'KJV'), 'curated-anxiety-and-peace-KJV');
  assert.notEqual(curatedCollectionId('anxiety-and-peace', 'KJV'), curatedCollectionId('anxiety-and-peace', 'ESV'));
});
