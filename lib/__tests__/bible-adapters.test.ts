// lib-ok: tests for the bible function's pure parsers (supabase/functions/bible/adapters/*-parse.ts)
/**
 * Fixtures copy the structure of real Crossway and API.Bible responses (tags, classes,
 * brackets, line breaks) with KJV or made-up words. Never paste licensed text here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanApiBibleText, parseApiBibleHtml, parseApiBibleVerse } from '../../supabase/functions/bible/adapters/apibible-parse';
import { esvChapterQuery, parseEsvPassage } from '../../supabase/functions/bible/adapters/esv-parse';
import { VERSE_COUNTS } from '../../supabase/functions/bible/verse-counts';

describe('ESV parser', () => {
  it('drops a psalm title before verse 1', () => {
    const text = 'A Psalm of David, when he fled from Absalom his son.\n\n[1] LORD, how are they increased that trouble me!\nmany are they that rise up against me.\n\n\n';
    assert.deepEqual(parseEsvPassage(text), { '1': 'LORD, how are they increased that trouble me! many are they that rise up against me.' });
  });

  it('drops a Psalm 119 stanza name before its first verse and after the last verse of the one before', () => {
    const text = 'Aleph\n\n[1] Blessed are the undefiled in the way,\nwho walk in the law of the LORD.\n[8] I will keep thy statutes:\nO forsake me not utterly.\n\n\nBeth\n\n[9] Wherewithal shall a young man cleanse his way?\n';
    assert.deepEqual(parseEsvPassage(text), {
      '1': 'Blessed are the undefiled in the way, who walk in the law of the LORD.',
      '8': 'I will keep thy statutes: O forsake me not utterly.',
      '9': 'Wherewithal shall a young man cleanse his way?',
    });
    assert.deepEqual(parseEsvPassage('Sin and Shin\n\n[161] Princes have persecuted me.\n\n\nTaw\n\n'), { '161': 'Princes have persecuted me.' });
  });

  it('drops Song of Solomon speaker labels', () => {
    const text = '[1] The song of songs, which is Solomon’s.\n\nShe\n\n[2] Let him kiss me with the kisses of his mouth:\nfor thy love is better than wine.\n\nOthers\n\n[4] We will be glad.\n\nHe\n\n[9] I have compared thee.\n';
    assert.deepEqual(parseEsvPassage(text), {
      '1': 'The song of songs, which is Solomon’s.',
      '2': 'Let him kiss me with the kisses of his mouth: for thy love is better than wine.',
      '4': 'We will be glad.',
      '9': 'I have compared thee.',
    });
  });

  it('drops a manuscript note and the double brackets around a passage', () => {
    const text = '[8] And they went out quickly, and fled from the sepulchre.\n\n[Some manuscripts end the book with verse 8.]\n\n[[[9] Now when Jesus was risen early.\n[20] And they went forth, and preached every where. Amen.]]\n';
    assert.deepEqual(parseEsvPassage(text), {
      '8': 'And they went out quickly, and fled from the sepulchre.',
      '9': 'Now when Jesus was risen early.',
      '20': 'And they went forth, and preached every where. Amen.',
    });
  });

  it('keeps a paragraph break inside a verse', () => {
    const text = '[1] Jude, the servant of Jesus Christ,\n\nTo them that are sanctified by God the Father:\n\n[2] Mercy unto you.\n';
    assert.equal(parseEsvPassage(text)['1'], 'Jude, the servant of Jesus Christ, To them that are sanctified by God the Father:');
  });

  it('leaves an omitted verse absent, so a single-verse fetch answers not found', () => {
    // Asked for 18:11, Crossway answers with 18:10 and 18:12.
    const verses = parseEsvPassage('[10] Take heed that ye despise not one of these little ones. [12] How think ye?\n\n');
    assert.equal(verses['11'], undefined);
    // One past the end of Jude returns its last verse.
    assert.equal(parseEsvPassage('[25] To the only wise God our Saviour. Amen.\n\n')['26'], undefined);
  });

  it('asks for a one-chapter book by verse numbers', () => {
    for (const book of ['Obadiah', 'Philemon', '2 John', '3 John', 'Jude']) {
      const counts = VERSE_COUNTS[book];
      assert.equal(esvChapterQuery(`${book} 1`, counts.length, counts[0]), `${book} 1:1-${counts[0]}`);
    }
    assert.equal(esvChapterQuery('John 3', VERSE_COUNTS.John.length, VERSE_COUNTS.John[2]), 'John 3');
  });
});

const v = (n: string) => `<span data-number="${n}" data-sid="PSA 23:${n}" class="v">${n}</span>`;

describe('API.Bible parser', () => {
  it('leaves a space at every poetry line, paragraph and quote break', () => {
    const html = `<p class="q1">${v('1')}The <span class="nd">Lord</span> is my shepherd;</p><p class="q2">I shall not want.</p><p class="q1">${v('2')}He said,<span class="wj">“Let there be light:”</span>and there was light.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), {
      '1': 'The Lord is my shepherd; I shall not want.',
      '2': 'He said, “Let there be light:” and there was light.',
    });
  });

  it('decodes HTML entities', () => {
    assert.equal(cleanApiBibleText('the <span class="nd">LORD</span>&#8217;s house &amp; the king&rsquo;s&nbsp;dale&mdash;and'), 'the LORD’s house & the king’s dale—and');
  });

  it('drops a Psalm 119 stanza heading, with or without its Hebrew letter', () => {
    const html = `<p class="q1">${v('8')}I will keep thy statutes.</p><p class="qa">ב Beth</p><p class="q1">${v('9')}Wherewithal shall a young man cleanse his way?</p><p class="qa">GIMEL</p><p class="q1">${v('17')}Deal bountifully.</p><p class="qa">ס <span class="sc">SAMEK</span></p><p class="q1">${v('113')}I hate vain thoughts.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), {
      '8': 'I will keep thy statutes.',
      '9': 'Wherewithal shall a young man cleanse his way?',
      '17': 'Deal bountifully.',
      '113': 'I hate vain thoughts.',
    });
  });

  it('drops a "Psalm N" heading and stanza letter before a single verse', () => {
    assert.deepEqual(parseApiBibleHtml(`<p class="d">Psalm 23</p><p class="q1">${v('1')}The LORD is my shepherd.</p>`), { '1': 'The LORD is my shepherd.' });
    assert.deepEqual(parseApiBibleHtml(`<p class="qa">א Aleph</p><p class="q1">${v('1')}Blessed are the undefiled.</p>`), { '1': 'Blessed are the undefiled.' });
  });

  it('keys a merged row under its first number', () => {
    const html = `<p class="p">${v('19')}As the LORD commanded.</p><p class="p"><span data-number="20-21" data-sid="NUM 1:20-21" class="v">20-21</span>The children of Reuben, forty and six thousand.</p><p class="p">${v('22')}Of the children of Simeon.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), {
      '19': 'As the LORD commanded.',
      '20': 'The children of Reuben, forty and six thousand.',
      '22': 'Of the children of Simeon.',
    });
  });

  it('serves a verse inside a merged row the merged text, marked so it is never cached', () => {
    const html = `<p class="p"><span data-number="20-21" data-sid="NUM 1:20-21" class="v">20-21</span>The children of Reuben, forty and six thousand.</p>`;
    assert.deepEqual(parseApiBibleVerse(html, '21'), { text: 'The children of Reuben, forty and six thousand.', merged: true });
    assert.deepEqual(parseApiBibleVerse(html, '20'), { text: 'The children of Reuben, forty and six thousand.', merged: false });
    assert.equal(parseApiBibleVerse(html, '22'), undefined);
    assert.equal(parseApiBibleVerse(`<p class="p">${v('10')}Take heed.</p><p class="p">${v('12')}How think ye?</p>`, '11'), undefined);
  });

  it('a range never repeats a merged row: the chapter keys it once, and the second number is not cacheable', () => {
    const chapter = `<p class="p">${v('19')}As the LORD commanded.</p><p class="p"><span data-number="20-21" data-sid="NUM 1:20-21" class="v">20-21</span>The children of Reuben.</p><p class="p">${v('22')}Of the children of Simeon.</p>`;
    // What the cache can hold for 19-22: the chapter's rows, plus single verses that aren't merged.
    const rows: Record<string, string> = { ...parseApiBibleHtml(chapter) };
    for (const verse of ['19', '20', '21', '22']) {
      const single = parseApiBibleVerse(chapter, verse);
      if (single && !single.merged) rows[verse] = single.text;
    }
    const range = Object.values(rows).join(' ');
    assert.equal(range, 'As the LORD commanded. The children of Reuben. Of the children of Simeon.');
  });

  it('gives a table row to the verse its span names, so the chapter and the single verse agree', () => {
    const span = (id: string, text: string) => `<span class="verse-span" data-verse-id="NUM.1.${id}">${text}</span>`;
    const row20 = `<p class="p">${span('20', `<span data-number="20" data-sid="NUM 1:20" class="v">20</span>`)}${span('20', 'The children of Reuben')}${span('20', '.')}</p>`;
    const table = `<table><tr><td>${span('22', 'Tribe')}</td><td>${span('22', 'Number')}</td></tr></table>`;
    const row22 = `<p class="p">${span('22', `<span data-number="22" data-sid="NUM 1:22" class="v">22</span>`)}${span('22', 'Of the children of Simeon.')}</p>`;
    assert.deepEqual(parseApiBibleHtml(row20 + table + row22), { '20': 'The children of Reuben.', '22': 'Tribe Number Of the children of Simeon.' });
    assert.deepEqual(parseApiBibleVerse(row20, '20'), { text: 'The children of Reuben.', merged: false });
    assert.deepEqual(parseApiBibleVerse(table + row22, '22'), { text: 'Tribe Number Of the children of Simeon.', merged: false });
  });

  it('keeps a verse that sits in a heading element', () => {
    const html = `<p class="d">${v('1')}A prayer of Habakkuk the prophet upon Shigionoth.</p><p class="q1">${v('2')}O LORD, I have heard thy speech.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), { '1': 'A prayer of Habakkuk the prophet upon Shigionoth.', '2': 'O LORD, I have heard thy speech.' });
  });

  it('drops a bracketed manuscript note after a verse', () => {
    const html = `<p class="p">${v('52')}Search, and look.</p><p class="m">[The earliest manuscripts do not have verses 53 to 11.]</p><p class="p">${v('53')}And every man went unto his own house.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), { '52': 'Search, and look.', '53': 'And every man went unto his own house.' });
  });

  it('ends a verse at the dash rule before a note or an alternate ending', () => {
    const html = `<p class="p">${v('8')}And they went out quickly. ----------</p><p class="pc">[<span class="it">The most ancient manuscripts end here.</span>]</p><p class="pc">[<span class="it">Shorter Ending</span>]</p><p class="p">Then they told it briefly.</p><p class="pc">[<span class="it">Longer Ending</span>]</p><p class="p">${v('9')}Now when Jesus was risen early.</p>`;
    assert.deepEqual(parseApiBibleHtml(html), { '8': 'And they went out quickly.', '9': 'Now when Jesus was risen early.' });
    assert.equal(cleanApiBibleText('Search, and look. [ <span class="it">The earliest manuscripts.</span>]'), 'Search, and look.');
  });

  it('leaves an omitted verse absent', () => {
    const html = `<p class="p">${v('10')}Take heed.</p><p class="p">${v('12')}How think ye?</p>`;
    assert.equal(parseApiBibleHtml(html)['11'], undefined);
  });
});
