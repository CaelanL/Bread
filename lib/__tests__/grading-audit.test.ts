// lib-ok: Regression net for lib/align.ts from the grading audit; harness lives in scripts/grading-audit.
/**
 * Grading audit regression cases. Run with `npm test`.
 *
 * "Holds today" tests replay a correct recitation of every bundled KJV verse through the
 * app's own chunking, alignment and scoring, and must stay at 100%.
 *
 * Each `todo` is a confirmed way a correct recitation is graded wrong today (IDs match the
 * audit's findings). They run and print but never fail the suite. When a fix lands, delete
 * that test's `todo` option so it guards the fix.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { audit, KJV_FIXTURE, replay } from '../../scripts/grading-audit/run';
import { PASSES } from '../../scripts/grading-audit/variations';
import { alignTranscription } from '../align';
import { calculateChunkScore, parseVerseIntoChunks } from '../study-chunks';
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

  it('engine transcripts of computer-voice recitations score no worse than when recorded', () => {
    const results = replay(KJV_FIXTURE, alignTranscription);
    const under = results.filter((r) => r.verdict.score < 100).length;
    assert.ok(results.length > 0);
    assert.ok(under <= KNOWN_FIXTURE_MISSES, `${under} clips under 100, was ${KNOWN_FIXTURE_MISSES}`);
  });
});

// Clips in fixtures/say-kjv.json that score under 100 today, all explained by the todos below.
const KNOWN_FIXTURE_MISSES = 22;

describe('grading audit — known bugs (todo until fixed)', () => {
  it('F1: a restart inside a number shows the said number words as missing and added', { todo: 'F1' }, () => {
    const alignment = alignTranscription(
      'And Eber lived after he begat Peleg four hundred and thirty years',
      'And Eber lived after he begat Peleg four hundred, four hundred and thirty years',
    );
    assert.deepEqual(alignment.filter((w) => w.status === 'missing'), []);
  });

  it('F2: the engine prints digits for KJV number wording', { todo: 'F2' }, () => {
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

  it('F3: the engine prints today\'s spelling of an old word', { todo: 'F3' }, () => {
    assertPerfect('the serpent was more subtil than any beast', 'the serpent was more subtle than any beast');
    assertPerfect('she was stedfastly minded to go with her', 'she was steadfastly minded to go with her');
    assertPerfect('as if a man had enquired at the oracle of God', 'as if a man had inquired at the oracle of God');
  });

  it('F4: the engine prints the American spelling', { todo: 'F4' }, () => {
    assertPerfect('Honour thy father and thy mother', 'Honor thy father and thy mother');
    assertPerfect('Thou shalt love thy neighbour as thyself', 'Thou shalt love thy neighbor as thyself');
  });

  it('F5: a joined compound next to a repeated word is not rejoined', { todo: 'F5' }, () => {
    assertPerfect(
      'it is a sign between me and the children of Israel for ever: for in six days',
      'it is a sign between me and the children of Israel forever, for in six days',
    );
  });

  it('F6: a split closed compound next to a repeated word is not rejoined', { todo: 'F6' }, () => {
    assertPerfect('Forasmuch as God hath shewed thee all this', 'For as much as God hath shewed thee all this');
    assertPerfect('Nevertheless the people be strong', 'Never the less the people be strong');
  });

  it('F7: a translation\'s omitted verse becomes an empty chunk that can never pass', { todo: 'F7' }, () => {
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

  it('F8: a possessive name said with an extra s', { todo: 'F8' }, () => {
    assertPerfect("But Moses' hands were heavy", "But Moses's hands were heavy");
  });

  it('F9: hesitations other than um, uh and hmm count as added words', { todo: 'F9' }, () => {
    assertPerfect('For God so loved the world', 'For God, uhm, so loved the world');
    assertPerfect('For God so loved the world', 'For God, erm, so loved the world');
  });

  it('F10: a number span runs across punctuation', { todo: 'F10' }, () => {
    assertPerfect('whose fingers and toes were four and twenty, six on each hand', 'whose fingers and toes were four and twenty, 6 on each hand');
  });

  it('F11: characters a licensed source could send are not folded (latent)', { todo: 'F11' }, () => {
    assertPerfect('the chil­dren of Israel', 'the children of Israel');
    assertPerfect('the chil​dren of Israel', 'the children of Israel');
    assertPerfect('the LORDʼs house', "the Lord's house");
    assertPerfect('Beth‐lehem', 'Bethlehem');
    assertPerfect('the LORD&#8217;s house', "the Lord's house");
  });

  it('F12: the legacy splitter (no keyed verses) drops or repeats words', { todo: 'F12' }, () => {
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
});
