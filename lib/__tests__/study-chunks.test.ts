/**
 * Unit tests for chunk parsing. Run with:
 *
 *   npx tsx --test lib/__tests__/study-chunks.test.ts
 *
 * Regression coverage for the Psalm 103 chunking bug (2026-08): the
 * session-cache-hit branch of fetchVerse returned combined text without
 * keyed verses, and getVerseText fabricated { "<start>": <wholeText> } —
 * putting the entire passage in chunk 1 and leaving the rest empty.
 *
 * Seam note: the actual fix lives in lib/api/bible.ts (fetchVerse /
 * getVerseText), which imports the supabase client and RN modules and is
 * not loadable under node:test. These tests lock the parser-level
 * invariants that the fix restores: complete keyed data → correct
 * per-verse chunks; missing keyed data → sentence fallback, never the
 * all-text-in-first-chunk shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseVerseIntoChunks } from '../study-chunks';
import type { SavedVerse } from '../storage';

// Structurally faithful Psalm 103:1-14 ESV shapes (poetry newlines kept)
const KEYED: Record<string, string> = {
  '1': 'Bless the LORD, O my soul,\nand all that is within me,\nbless his holy name!',
  '2': 'Bless the LORD, O my soul,\nand forget not all his benefits,',
  '3': 'who forgives all your iniquity,\nwho heals all your diseases,',
  '4': 'who redeems your life from the pit,\nwho crowns you with steadfast love and mercy,',
  '5': 'who satisfies you with good\nso that your youth is renewed like the eagle’s.',
  '6': 'The LORD works righteousness\nand justice for all who are oppressed.',
  '7': 'He made known his ways to Moses,\nhis acts to the people of Israel.',
  '8': 'The LORD is merciful and gracious,\nslow to anger and abounding in steadfast love.',
  '9': 'He will not always chide,\nnor will he keep his anger forever.',
  '10': 'He does not deal with us according to our sins,\nnor repay us according to our iniquities.',
  '11': 'For as high as the heavens are above the earth,\nso great is his steadfast love toward those who fear him;',
  '12': 'as far as the east is from the west,\nso far does he remove our transgressions from us.',
  '13': 'As a father shows compassion to his children,\nso the LORD shows compassion to those who fear him.',
  '14': 'For he knows our frame;\nhe remembers that we are dust.',
};

const COMBINED = Object.values(KEYED).join(' ');

function makeVerse(verses: Record<string, string> | undefined): SavedVerse {
  return {
    id: 'test-id',
    book: 'Psalms',
    chapter: 103,
    verseStart: 1,
    verseEnd: 14,
    version: 'ESV',
    text: COMBINED,
    verses,
  } as SavedVerse;
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

describe('parseVerseIntoChunks — multi-verse range (Psalm 103:1-14)', () => {
  it('complete keyed data + chunkSize 1 → one non-empty chunk per verse', () => {
    const chunks = parseVerseIntoChunks(makeVerse(KEYED), 'easy', 1, 0);

    assert.equal(chunks.length, 14);
    for (const [i, chunk] of chunks.entries()) {
      assert.equal(chunk.verseNum, i + 1);
      assert.equal(chunk.text, KEYED[(i + 1).toString()], `chunk ${i + 1} text mismatch`);
      assert.ok(wordCount(chunk.text) > 0, `chunk ${i + 1} is empty`);
    }
  });

  it('complete keyed data + chunkSize >= verse count → single chunk with all words', () => {
    const chunks = parseVerseIntoChunks(makeVerse(KEYED), 'easy', 14, 0);

    assert.equal(chunks.length, 1);
    assert.equal(wordCount(chunks[0].text), wordCount(COMBINED));
    assert.equal(chunks[0].verseNum, 1);
    assert.equal(chunks[0].verseNumEnd, 14);
  });

  it('missing keyed data (empty map) → sentence fallback, never all-in-first-chunk', () => {
    // The fix returns verses: {} when the API response has no keyed data,
    // which routes here. The fallback's boundaries are imperfect, but it
    // must not reproduce the bug shape (chunk 1 = everything, rest empty).
    const chunks = parseVerseIntoChunks(makeVerse({}), 'easy', 1, 0);

    assert.equal(chunks.length, 14);
    const c1 = wordCount(chunks[0].text);
    const total = wordCount(COMBINED);
    assert.ok(c1 < total, `chunk 1 has all ${total} words — bug shape`);
    const nonEmpty = chunks.filter((c) => wordCount(c.text) > 0).length;
    assert.ok(nonEmpty > 1, 'all text collapsed into a single chunk');
  });

  it('poisoned keyed map ({ "1": wholeText }) reproduces the bug shape (documents why the fetch layer must never emit it)', () => {
    const chunks = parseVerseIntoChunks(makeVerse({ '1': COMBINED }), 'easy', 1, 0);

    assert.equal(chunks.length, 14);
    assert.equal(wordCount(chunks[0].text), wordCount(COMBINED));
    assert.ok(chunks.slice(1).every((c) => wordCount(c.text) === 0));
  });
});
