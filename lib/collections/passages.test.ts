// lib-ok: Exercise the keyed verse and translation guarantees at the Bible read boundary.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BibleVerse } from '@/lib/api/bible';

import { CURATED_COLLECTIONS } from './catalog';
import { createCollectionPassageReader, readCollectionPassage, validateCollectionPassages } from './passages';

const firstPassage = CURATED_COLLECTIONS[0].passages[0];
const pair = CURATED_COLLECTIONS[0].passages[1];

test('a passage preview returns both keyed verses in the selected translation', async () => {
  const text = await readCollectionPassage(pair, 'KJV', async (reference, version) => {
    assert.equal(reference, 'Philippians 4:6-7');
    assert.equal(version, 'KJV');
    return { version, verses: { 7: 'Second verse.', 6: 'First verse.' } };
  });
  assert.equal(text, 'First verse. Second verse.');
});

test('import validation rejects a collection containing an incomplete range', async () => {
  await assert.rejects(validateCollectionPassages([firstPassage, pair], 'ESV', async (reference, version) => {
    const verses: Record<string, string> = reference === '1 Peter 5:7' ? { 7: 'Present.' } : { 6: 'Only one verse.' };
    return { version, verses };
  }), /Philippians 4:6-7 is incomplete in ESV/);
});

test('a mismatched translation cannot display under the selected translation', async () => {
  await assert.rejects(readCollectionPassage(firstPassage, 'ESV', async () => ({
    version: 'KJV',
    verses: { 7: 'From another translation.' },
  })), /incomplete in ESV/);
});

test('an outstanding preview cannot return text after its translation changes', async () => {
  const previous = new AbortController();
  let finish: (value: Pick<BibleVerse, 'version' | 'verses'>) => void = () => {};
  const pending = new Promise<Pick<BibleVerse, 'version' | 'verses'>>((resolve) => { finish = resolve; });
  const oldPreview = readCollectionPassage(firstPassage, 'ESV', () => pending, previous.signal);

  previous.abort();
  const nextPreview = await readCollectionPassage(firstPassage, 'KJV', async () => ({
    version: 'KJV',
    verses: { 7: 'Current preview.' },
  }));
  finish({ version: 'ESV', verses: { 7: 'Previous preview.' } });

  assert.equal(nextPreview, 'Current preview.');
  await assert.rejects(oldPreview, /preview canceled/);
});

test('preloading and expanding a passage share one read and retain its successful result', async () => {
  let requests = 0;
  let finish: (value: Pick<BibleVerse, 'version' | 'verses'>) => void = () => {};
  const pending = new Promise<Pick<BibleVerse, 'version' | 'verses'>>((resolve) => { finish = resolve; });
  const read = createCollectionPassageReader('KJV', async (reference, version) => {
    requests++;
    assert.equal(reference, '1 Peter 5:7');
    assert.equal(version, 'KJV');
    return pending;
  });

  const preload = read(firstPassage);
  const expanded = read(firstPassage);
  assert.equal(requests, 1);
  finish({ version: 'KJV', verses: { 7: 'Shared result.' } });
  assert.deepEqual(await Promise.all([preload, expanded]), ['Shared result.', 'Shared result.']);
  assert.equal(await read(firstPassage), 'Shared result.');
  assert.equal(requests, 1);
});

test('a failed preload can be retried and a new translation reads its own text', async () => {
  let requests = 0;
  const read = createCollectionPassageReader('ESV', async () => {
    requests++;
    if (requests === 1) throw new Error('Unavailable');
    return { version: 'ESV', verses: { 7: 'Retried ESV.' } };
  });
  await assert.rejects(read(firstPassage), /Could not load/);
  assert.equal(await read(firstPassage), 'Retried ESV.');
  assert.equal(requests, 2);

  const nextVersion = createCollectionPassageReader('KJV', async (_, version) => ({
    version,
    verses: { 7: 'Selected KJV.' },
  }));
  assert.equal(await nextVersion(firstPassage), 'Selected KJV.');
  assert.equal(await read(firstPassage), 'Retried ESV.');
});
