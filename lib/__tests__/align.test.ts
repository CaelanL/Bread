import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alignTranscription } from '../align';

const SMALL_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function integerWords(value: number): string {
  if (value < 20) return SMALL_WORDS[value];
  if (value < 100) {
    const tens = TENS_WORDS[Math.floor(value / 10)];
    const unit = value % 10;
    return unit ? `${tens}-${SMALL_WORDS[unit]}` : tens;
  }
  const hundreds = `${SMALL_WORDS[Math.floor(value / 100)]} hundred`;
  const remainder = value % 100;
  return remainder ? `${hundreds} ${integerWords(remainder)}` : hundreds;
}

function assertEquivalent(expected: string, transcript: string) {
  const alignment = alignTranscription(expected, transcript);
  assert.ok(
    alignment.every((item) => item.status === 'correct'),
    `${JSON.stringify({ expected, transcript, alignment })}`
  );
}

function assertNotEquivalent(expected: string, transcript: string) {
  const alignment = alignTranscription(expected, transcript);
  assert.ok(
    alignment.some((item) => item.status !== 'correct'),
    `${expected} should not match ${transcript}`
  );
}

describe('alignTranscription — existing acoustic normalization', () => {
  it('keeps punctuation, case, apostrophe, and hyphen differences fair', () => {
    assertEquivalent("The eagle's cry.", 'the eagles cry');
    assertEquivalent('Beth-lehem forever', 'Bethlehem for ever');
  });

  it('drops transcript-side hesitation fillers', () => {
    assertEquivalent('The Lord returned', 'um the Lord uh returned');
  });
});

describe('alignTranscription — numeric equivalence', () => {
  const equivalentPairs = [
    ['The seventy-two returned', 'The 72 returned'],
    ['The 72 returned', 'The seventy-two returned'],
    ['There were 2,172 people', 'There were two thousand one hundred seventy-two people'],
    ['He was one hundred and thirty years old', 'He was 130 years old'],
    ['The number was 144,000', 'The number was one hundred forty-four thousand'],
    ['The number was six hundred sixty-six', 'The number was 666'],
    ['On the seventeenth day', 'On the 17th day'],
    ['In his six hundredth year', 'In his 600th year'],
    ['The number was 144,000', 'The number was 144 , 000'],
  ] as const;

  for (const [expected, transcript] of equivalentPairs) {
    it(`${expected} ↔ ${transcript}`, () => {
      assertEquivalent(expected, transcript);
      assertEquivalent(transcript, expected);
    });
  }

  it('preserves the expected translation wording in the result', () => {
    const alignment = alignTranscription('The seventy-two returned', 'The 72 returned');
    assert.deepEqual(
      alignment.map(({ word, status }) => ({ word, status })),
      [
        { word: 'The', status: 'correct' },
        { word: 'seventy-two', status: 'correct' },
        { word: 'returned', status: 'correct' },
      ]
    );
  });

  it('matches every standard integer from zero through 999 in both directions', () => {
    for (let value = 0; value <= 999; value++) {
      const words = integerWords(value);
      assertEquivalent(String(value), words);
      assertEquivalent(words, String(value));
    }
  });

  it('handles representative scale and ordinal boundaries', () => {
    const pairs = [
      ['1,001', 'one thousand one'],
      ['1,010', 'one thousand ten'],
      ['1,100', 'one thousand one hundred'],
      ['999,999', 'nine hundred ninety-nine thousand nine hundred ninety-nine'],
      ['11th', 'eleventh'],
      ['0th', 'zeroth'],
      ['12th', 'twelfth'],
      ['13th', 'thirteenth'],
      ['21st', 'twenty-first'],
      ['22nd', 'twenty-second'],
      ['23rd', 'twenty-third'],
      ['24th', 'twenty-fourth'],
      ['101st', 'one hundred first'],
      ['100th', 'hundredth'],
      ['1,000th', 'thousandth'],
      ['1,000,000th', 'millionth'],
      [
        '999,999,999,999',
        'nine hundred and ninety nine billion nine hundred and ninety nine million nine hundred and ninety nine thousand nine hundred and ninety nine',
      ],
    ] as const;

    for (const [digits, words] of pairs) {
      assertEquivalent(digits, words);
      assertEquivalent(words, digits);
    }
  });

  it('matches a number even with an unrelated added word beside it', () => {
    const alignment = alignTranscription('seventy two returned', 'actually 72 returned');
    assert.deepEqual(
      alignment.map(({ word, status }) => ({ word, status })),
      [
        { word: 'actually', status: 'added' },
        { word: 'seventy', status: 'correct' },
        { word: 'two', status: 'correct' },
        { word: 'returned', status: 'correct' },
      ]
    );
  });

  it('matches a number even with an unrelated omitted word beside it', () => {
    const alignment = alignTranscription('exactly seventy two returned', '72 returned');
    assert.deepEqual(
      alignment.map(({ word, status }) => ({ word, status })),
      [
        { word: 'exactly', status: 'missing' },
        { word: 'seventy', status: 'correct' },
        { word: 'two', status: 'correct' },
        { word: 'returned', status: 'correct' },
      ]
    );
  });
});

describe('alignTranscription — numeric false-positive guards', () => {
  const nonEquivalentPairs = [
    ['72', '70'],
    ['72', 'seventy-third'],
    ['72', '7 2'],
    ['10', '1 0'],
    ['2172', '21 72'],
    ['72', '72nd'],
    ['eleven', '11st'],
    ['5', 'two and three'],
    ['200', 'one hundred hundred'],
    ['30', 'twenty ten'],
    ['1001', 'thousand one'],
    ['72-year-old', 'seventy-two-year-old'],
    ['2172', '2,17'],
  ] as const;

  for (const [expected, transcript] of nonEquivalentPairs) {
    it(`${expected} ≠ ${transcript}`, () => {
      assertNotEquivalent(expected, transcript);
    });
  }
});
