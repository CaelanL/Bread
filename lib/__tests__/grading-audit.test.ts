// lib-ok: Regression net for lib/align.ts from the grading audit; harness lives in scripts/grading-audit.
/**
 * Grading audit regression cases. Run with `npm test`.
 *
 * "Holds today" tests replay a correct recitation of every bundled KJV verse through the
 * app's own chunking, alignment and scoring, and must stay at 100%.
 *
 * Each `todo` is a confirmed way a correct recitation is graded wrong today (IDs match
 * docs/grading-audit.md). They run but never fail the suite: node prints each one as
 * "✖ ... # known bug, fails until fixed" with its assertion under "failing tests", and that
 * is expected while "fail 0". When a fix lands, delete that test's `todo` option so it
 * guards the fix.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { audit, clipId, KJV_FIXTURE, KJV_FIXTURE_MISSES, loadSource, refText, replay } from '../../scripts/grading-audit/run';
import { PASSES } from '../../scripts/grading-audit/variations';
import { alignTranscription } from '../align';
import { calculateChunkScore, calculateFinalScore, parseVerseIntoChunks } from '../study-chunks';
import type { SavedVerse } from '../storage';

function wrong(expected: string, transcript: string): string[] {
  return alignTranscription(expected, transcript)
    .filter((w) => w.status !== 'correct')
    .map((w) => `${w.status}:${w.word}`);
}

function assertPerfect(expected: string, transcript: string) {
  const alignment = alignTranscription(expected, transcript);
  assert.equal(calculateChunkScore(alignment), 100, JSON.stringify(wrong(expected, transcript)));
}

function kjvPass(name: string) {
  const pass = PASSES.find((p) => p.name === name);
  assert.ok(pass, name);
  return audit({ source: 'KJV', passes: [pass], chunkSize: '1', align: alignTranscription })[0];
}

describe('grading audit — holds today on every KJV verse', () => {
  const fair = [
    'plain',
    'engine-style',
    'possessive:dropped',
    'compound:join-hyphenated',
    'unicode:curly-quotes',
    'unicode:transcript-curly-apostrophe',
    'unicode:em-dash-joined',
    'unicode:nbsp-separators',
    'speech:filler-um',
  ];
  for (const name of fair) {
    it(name, () => {
      const stats = kjvPass(name);
      assert.ok(stats.checked > 0);
      assert.equal(stats.under100, 0, JSON.stringify(Object.keys(stats.signatures).slice(0, 3)));
    });
  }

  // The misses file lists the clips under 100 when it was written: the todos below plus engine
  // mishearings (dropped first word, names, archaic forms modernised). Drop a clip from it once
  // a fix makes it pass.
  it('no engine transcript of a computer-voice recitation newly scores under 100', () => {
    const known = new Set<string>(JSON.parse(readFileSync(KJV_FIXTURE_MISSES, 'utf8')));
    const results = replay(KJV_FIXTURE, alignTranscription);
    assert.ok(results.length > 0);
    const newly = results.filter((r) => r.verdict.score < 100 && !known.has(clipId(r.clip)));
    assert.deepEqual(newly.map((r) => `${clipId(r.clip)} ${r.verdict.score}%`), []);
  });
});

const TODO = 'known bug, fails until fixed';

describe('grading audit — known bugs (todo until fixed)', () => {
  it('F1: a restart inside a number shows the said number words as missing and added', { todo: TODO }, () => {
    const alignment = alignTranscription(
      'And Eber lived after he begat Peleg four hundred and thirty years',
      'And Eber lived after he begat Peleg four hundred, four hundred and thirty years',
    );
    assert.deepEqual(alignment.filter((w) => w.status === 'missing'), []);
  });

  it('F2: the engine prints digits for KJV number wording', { todo: TODO }, () => {
    assertPerfect('were an hundred and thirty shekels', 'were 130 shekels');
    assertPerfect('he had a thousand and four hundred chariots', 'he had 1,400 chariots');
    assertPerfect(
      'were six hundred thousand and three thousand and five hundred and fifty.',
      'were 600,000 and 3,550.',
    );
    assertPerfect('mourned for him threescore and ten days', 'mourned for him 70 days');
    assertPerfect('Five and twenty years old was he', '25 years old was he');
    assertPerfect('were thirty thousand and five hundred', 'were 30,500');
  });

  it('F3: the engine prints today\'s spelling of an old word', { todo: TODO }, () => {
    assertPerfect('the serpent was more subtil than any beast', 'the serpent was more subtle than any beast');
    assertPerfect('she was stedfastly minded to go with her', 'she was steadfastly minded to go with her');
    assertPerfect('as if a man had enquired at the oracle of God', 'as if a man had inquired at the oracle of God');
  });

  it('F4: the engine prints the American spelling', { todo: TODO }, () => {
    assertPerfect('Honour thy father and thy mother', 'Honor thy father and thy mother');
    assertPerfect('Thou shalt love thy neighbour as thyself', 'Thou shalt love thy neighbor as thyself');
  });

  it('F5: a joined compound next to a repeated word is not rejoined', { todo: TODO }, () => {
    assertPerfect(
      'it is a sign between me and the children of Israel for ever: for in six days',
      'it is a sign between me and the children of Israel forever, for in six days',
    );
  });

  it('F6: a split closed compound next to a repeated word is not rejoined', { todo: TODO }, () => {
    assertPerfect('Forasmuch as God hath shewed thee all this', 'For as much as God hath shewed thee all this');
    assertPerfect('Nevertheless the people be strong', 'Never the less the people be strong');
  });

  it('F7: a translation\'s omitted verse becomes an empty chunk that can never pass', { todo: TODO }, () => {
    const verse = {
      id: 'omitted',
      book: 'Matthew',
      chapter: 17,
      verseStart: 20,
      verseEnd: 22,
      version: 'ESV',
      text: 'Verse twenty. Verse twenty-two.',
      verses: { '20': 'Verse twenty.', '22': 'Verse twenty-two.' },
    } as unknown as SavedVerse;
    const chunks = parseVerseIntoChunks(verse, 'easy', 1, 0);
    assert.ok(chunks.every((c) => c.text.trim() !== ''), JSON.stringify(chunks.map((c) => c.text)));
  });

  it('F8: a possessive name said with an extra s', { todo: TODO }, () => {
    assertPerfect("But Moses' hands were heavy", "But Moses's hands were heavy");
  });

  it('F9: hesitations other than um, uh and hmm count as added words', { todo: TODO }, () => {
    assertPerfect('For God so loved the world', 'For God, uhm, so loved the world');
    assertPerfect('For God so loved the world', 'For God, erm, so loved the world');
  });

  it('F10: a number span runs across punctuation', { todo: TODO }, () => {
    assertPerfect('whose fingers and toes were four and twenty, six on each hand', 'whose fingers and toes were four and twenty, 6 on each hand');
  });

  it('F11: characters a licensed source could send are not folded (latent)', { todo: TODO }, () => {
    assertPerfect('the chil­dren of Israel', 'the children of Israel');
    assertPerfect('the chil​dren of Israel', 'the children of Israel');
    assertPerfect('the LORDʼs house', "the Lord's house");
    assertPerfect('Beth‐lehem', 'Bethlehem');
    assertPerfect('the LORD&#8217;s house', "the Lord's house");
  });

  it('F12: the legacy splitter (no keyed verses) drops or repeats words', { todo: TODO }, () => {
    const verses = { '1': 'In the beginning. God created.', '2': 'And the earth.' };
    const verse = {
      id: 'legacy', book: 'Genesis', chapter: 1, verseStart: 1, verseEnd: 2, version: 'KJV',
      text: Object.values(verses).join(' '), verses: {},
    } as unknown as SavedVerse;
    const warn = console.warn;
    console.warn = () => {};
    const chunks = parseVerseIntoChunks(verse, 'easy', 1, 0);
    console.warn = warn;
    assert.equal(chunks.map((c) => c.text).join(' '), verse.text);
  });

  it('RC2: "thousand and N hundred" printed as digits', { todo: TODO }, () => {
    assertPerfect('were six thousand and two hundred.', 'were 6,200.');
  });

  it('RC2: a wrong number in digits matches the verse\'s number words', { todo: TODO }, () => {
    const correctWords = (expected: string, transcript: string) =>
      alignTranscription(expected, transcript).filter((w) => w.status === 'correct').map((w) => w.word);
    assert.ok(!correctWords('were seven thousand and five hundred.', 'were 7,005.').includes('seven'));
    assert.ok(
      !correctWords('were six hundred thousand and three thousand five hundred and fifty.', 'were 600,003 and 550.').includes('three'),
    );
  });

  it('RC3: one stutter next to "to day" and "for ever" costs the whole stretch', { todo: TODO }, () => {
    const alignment = alignTranscription(
      'Jesus Christ the same yesterday, and to day, and for ever.',
      'Jesus Christ the same yesterday and and today and forever',
    );
    assert.ok(calculateChunkScore(alignment) >= 90, JSON.stringify(wrong('Jesus Christ the same yesterday, and to day, and for ever.', 'Jesus Christ the same yesterday and and today and forever')));
  });

  it('RC8: a verse never said (or revealed) still lets the session reach 90', { todo: TODO }, () => {
    const kjv = loadSource('KJV');
    const alignments = new Map<number, ReturnType<typeof alignTranscription>>();
    for (let v = 1; v <= 6; v++) {
      const text = refText(kjv, `Psalms 23:${v}`);
      alignments.set(v - 1, alignTranscription(text, v === 1 ? '' : text));
    }
    assert.ok(calculateFinalScore(alignments) < 90);
  });
});
