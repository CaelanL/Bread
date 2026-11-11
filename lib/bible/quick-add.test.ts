// lib-ok: Tests for the quick-add parser.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { completeBook, hintFor, matchBooks, parseQuickAdd } from './quick-add';

describe('matchBooks', () => {
  it('matches ordinals with or without a space', () => {
    assert.deepEqual(matchBooks('1t'), ['1 Thessalonians', '1 Timothy']);
    assert.deepEqual(matchBooks('1 t'), ['1 Thessalonians', '1 Timothy']);
    assert.deepEqual(matchBooks('1th'), ['1 Thessalonians']);
    assert.deepEqual(matchBooks('3'), ['3 John']);
  });

  it('matches multi-word names and known abbreviations', () => {
    assert.deepEqual(matchBooks('song of sol'), ['Song of Solomon']);
    assert.deepEqual(matchBooks('gn'), ['Genesis']);
    assert.deepEqual(matchBooks('jn'), ['John']);
    assert.deepEqual(matchBooks('1 jn'), ['1 John']);
  });

  it('returns nothing for blank or unknown input', () => {
    assert.deepEqual(matchBooks(''), []);
    assert.deepEqual(matchBooks('xq'), []);
  });
});

describe('parseQuickAdd', () => {
  it('is empty for blank input', () => {
    assert.deepEqual(parseQuickAdd('  '), { kind: 'empty' });
  });

  it('stays on the book while it is ambiguous or has no numbers', () => {
    assert.deepEqual(parseQuickAdd('1t 2 3'), { kind: 'book', query: '1t', matches: ['1 Thessalonians', '1 Timothy'] });
    assert.deepEqual(parseQuickAdd('Genesis '), { kind: 'book', query: 'Genesis', matches: ['Genesis'] });
  });

  it('splits chapter and verse on any separator', () => {
    const expected = { kind: 'verse', book: 'Genesis', chapter: 5, verseStart: 5, verseEnd: 5 };
    for (const text of ['Gen 5 5', 'Gen 5:5', 'Gen 5.5', 'Gen 5,5', 'Gen 5/5', 'Gen 5 :; 5', 'gen5:5']) {
      assert.deepEqual(parseQuickAdd(text), expected, text);
    }
  });

  it('reads the first dash as the chapter separator', () => {
    assert.deepEqual(parseQuickAdd('Gen 5-10'), { kind: 'verse', book: 'Genesis', chapter: 5, verseStart: 10, verseEnd: 10 });
  });

  it('reads a dash before the third number as a range', () => {
    assert.deepEqual(parseQuickAdd('1th 2 3-5'), { kind: 'verse', book: '1 Thessalonians', chapter: 2, verseStart: 3, verseEnd: 5 });
    assert.deepEqual(parseQuickAdd('Gen 5:5 - 10'), { kind: 'verse', book: 'Genesis', chapter: 5, verseStart: 5, verseEnd: 10 });
  });

  it('flags a reversed range', () => {
    assert.deepEqual(parseQuickAdd('Gen 5:5-3'), {
      kind: 'error', reason: 'reversed', book: 'Genesis', chapter: 5, verseStart: 5, verseEnd: 3, verseCount: 32,
    });
  });

  it('flags a range across chapters, or a third number without a dash', () => {
    assert.equal(reason(parseQuickAdd('Gen 5:30-6:2')), 'cross-chapter');
    assert.equal(reason(parseQuickAdd('Gen 5 30 31')), 'cross-chapter');
  });

  it('gives a chapter hint for a chapter alone', () => {
    assert.deepEqual(parseQuickAdd('Gen 5'), { kind: 'chapter', book: 'Genesis', chapter: 5, verseCount: 32 });
  });

  it('flags a chapter or verse out of range', () => {
    assert.deepEqual(parseQuickAdd('John 22 1'), {
      kind: 'error', reason: 'chapter', book: 'John', chapter: 22, chapterCount: 21, verseStart: 1, verseEnd: 1,
    });
    assert.equal(reason(parseQuickAdd('John 0')), 'chapter');
    assert.equal(reason(parseQuickAdd('John 3 37')), 'verse');
    assert.equal(reason(parseQuickAdd('John 3 0')), 'verse');
    assert.equal(reason(parseQuickAdd('John 3 35-37')), 'verse');
  });
});

describe('completeBook', () => {
  it('completes a unique match and keeps the numbers', () => {
    assert.equal(completeBook('Gen'), 'Genesis ');
    assert.equal(completeBook('Gen5'), 'Genesis 5');
    assert.equal(completeBook('song 2:1'), 'Song of Solomon 2:1');
  });

  it('uses the given book', () => {
    assert.equal(completeBook('1t', '1 Timothy'), '1 Timothy ');
  });

  it('returns null while the book is ambiguous', () => {
    assert.equal(completeBook('1t'), null);
  });
});

describe('hintFor', () => {
  it('words each state', () => {
    assert.equal(hintFor(parseQuickAdd('')), null);
    assert.equal(hintFor(parseQuickAdd('1t')), 'Space picks the only match · 2 5-7 for a range');
    assert.equal(hintFor(parseQuickAdd('xq')), 'No book matches');
    assert.equal(hintFor(parseQuickAdd('Gen 5')), 'Genesis 5 has 32 verses');
    assert.equal(hintFor(parseQuickAdd('Gen 5:5-10')), 'Return adds Genesis 5:5-10');
    assert.equal(hintFor(parseQuickAdd('John 22 1')), 'John has 21 chapters');
    assert.equal(hintFor(parseQuickAdd('John 3 37')), 'John 3 has 36 verses');
    assert.equal(hintFor(parseQuickAdd('Gen 5:5-3')), 'Start before end: try 5:3-5');
    assert.equal(hintFor(parseQuickAdd('Gen 5:30-6:2')), 'One chapter per verse: try 5:30-32');
  });
});

function reason(parse: ReturnType<typeof parseQuickAdd>) {
  return parse.kind === 'error' ? parse.reason : parse.kind;
}
