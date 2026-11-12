// lib-ok: Tests for the quick-add parser.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { completeBook, matchBooks, parseQuickAdd, quickAddRows } from './quick-add';

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

  it('reads a chapter alone', () => {
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

describe('quickAddRows', () => {
  const fills = (input: string) => quickAddRows(input).map((row) => (row.kind === 'fill' ? row.text : row.kind));
  const adds = (input: string) =>
    quickAddRows(input).map((row) => (row.kind === 'add' ? `${row.chapter}:${row.verseStart}-${row.verseEnd}` : row.kind));

  it('offers matching books that fill the field', () => {
    assert.deepEqual(fills('R'), ['Ruth ', 'Romans ', 'Revelation ']);
    assert.deepEqual(fills('1t 2 3'), ['1 Thessalonians 2 3', '1 Timothy 2 3']);
    assert.deepEqual(fills('Romans'), ['Romans ']);
  });

  it('offers the first chapters once the book is filled', () => {
    assert.deepEqual(fills('Romans '), ['Romans 1', 'Romans 2', 'Romans 3', 'Romans 4', 'Romans 5', 'Romans 6']);
    assert.deepEqual(fills('Jude '), ['Jude 1']);
  });

  it('offers the first verses of a chapter as fills, never an add', () => {
    assert.deepEqual(fills('Romans 8'), ['Romans 8:1', 'Romans 8:2', 'Romans 8:3', 'Romans 8:4', 'Romans 8:5', 'Romans 8:6']);
    assert.deepEqual(fills('Rom 8:'), fills('Romans 8'));
  });

  it('puts the verse itself on top, then ranges from it', () => {
    assert.deepEqual(adds('Romans 8:1'), ['8:1-1', '8:1-2', '8:1-3', '8:1-4', '8:1-5', '8:1-6']);
    assert.deepEqual(adds('Rom 8 28'), ['8:28-28', '8:28-29', '8:28-30', '8:28-31', '8:28-32', '8:28-33']);
    assert.deepEqual(adds('Romans 8:38'), ['8:38-38', '8:38-39']);
  });

  it('offers a typed range alone', () => {
    assert.deepEqual(adds('Romans 8:1-4'), ['8:1-4']);
  });

  it('shows nothing for no match or a reference outside the book', () => {
    for (const text of ['', 'xq', 'Romans 17', 'Romans 8:40', 'Romans 8:4-1', 'Romans 8:30-9:2']) {
      assert.deepEqual(quickAddRows(text), [], text);
    }
  });
});

function reason(parse: ReturnType<typeof parseQuickAdd>) {
  return parse.kind === 'error' ? parse.reason : parse.kind;
}
