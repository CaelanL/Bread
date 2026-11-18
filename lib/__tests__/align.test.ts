import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alignTranscription } from '../align';
import { calculateChunkScore } from '../study-chunks';

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

describe('alignTranscription — spelling and character normalization', () => {
  const equivalent = [
    ['the kingʼs dale', 'the kings dale'], // modifier-letter apostrophe
    ['Beth‐el', 'Beth el'], // Unicode hyphen
    ['chil\u00ADdren', 'children'], // soft hyphen
    ['Israél', 'Israel'], // precomposed accent
    ['Israe\u0301l', 'Israel'], // combining accent
    ['the rosé', 'the rose'],
    ['O\u200BLORD', 'O LORD'], // F3: a zero-width space between two words
    ['an instructer of every artificer', 'an instructor of every artificer'],
    ['for his name’s saké', 'for his name’s sake'],
    ['Judæa', 'Judea'], // ligature, then the name list
    ['him…and', 'him and'], // ellipsis joins two words
    ['The LORD is my shepherd;I shall', 'The Lord is my shepherd, I shall'],
    ['And God said,“Let there be light:”and there was', 'And God said, let there be light, and there was'],
    ['honour thy father', 'honor thy father'],
    ['our Saviour', 'our Savior'],
    ['shew me thy ways', 'show me thy ways'],
    ['marvellous in our eyes', 'marvelous in our eyes'],
    ['they were an hungred', 'they were an hungered'],
    ['he set at nought', 'he set at naught'],
    ['the daughter of Sion', 'the daughter of Zion'],
    ['the jubile', 'the jubilee'],
    ["Moses' hands", "Moses's hands"],
    ["at Jesus' feet", "at Jesus's feet"],
    ["thy sons, and thy sons' wives", "thy sons, and thy sons's wives"],
    ["his sons, and his sons' sons", "his sons, and his sons's sons"],
    ["Moses' hands and Moses' rod", "Moses's hands and Moses rod"],
    // Odd spellings and names the engine wrote in the voice tests.
    ['Hazael, Take a present', 'hazel, take a present'],
    ['vaunteth not itself, Doth not behave itself unseemly', 'vaunteth not itself, doth not behave itself unseamly'],
    ['ships at Ezion-geber.', 'ships at Ezion-gebar.'],
    ["for thy great mercies' sake", "for thy great mercy's sake"],
    ['And David enquired of the LORD', 'And David enquied of the LORD'],
    ['he loved also Rachel more than Leah', 'he loved also Rachel more than Lee'],
  ] as const;
  for (const [expected, transcript] of equivalent) {
    it(`${expected} = ${transcript}`, () => {
      assertEquivalent(expected, transcript);
      assertEquivalent(transcript, expected);
    });
  }

  it('shows the verse\'s own spelling for a matched word', () => {
    assert.deepEqual(alignTranscription('Honour thy father', 'honor thy father').map((w) => w.word), ['Honour', 'thy', 'father']);
    assert.deepEqual(alignTranscription('Hazael, Take', 'hazel, take').map((w) => w.word), ['Hazael,', 'Take']);
  });

  it('drops more hesitation spellings, but not words scripture uses', () => {
    assertEquivalent('For God so loved the world', 'For God, uhm, so loved the world');
    assertEquivalent('For God so loved the world', 'For God, erm, mm-hmm, uh-huh so loved the world');
    assertNotEquivalent('For God so loved the world', 'For God ah so loved the world');
    assertNotEquivalent('For God so loved the world', 'For God er so loved the world');
  });

  const different = [
    ['timber', 'timbre'], ['Peter', 'petre'], ['scoured', 'scored'], ['outer', 'outré'],
    ["the ass's colt", 'the ass colt'], ['the witness', "the witness's"],
  ] as const;
  for (const [expected, transcript] of different) {
    it(`${expected} ≠ ${transcript}`, () => assertNotEquivalent(expected, transcript));
  }

  // "Moses's" matches only "Moses'", not plain "Moses".
  const extraPossessive = [
    ['Jesus answered', "Jesus's answered"],
    ['the rod of Moses', "the rod of Moses's"],
    ['waters', "waters's"],
    ["thy sons, and thy sons' wives", "thy sons's, and thy sons' wives"],
  ] as const;
  for (const [plain, possessive] of extraPossessive) {
    it(`${plain} ≠ ${possessive}`, () => {
      assertNotEquivalent(plain, possessive);
      assertNotEquivalent(possessive, plain);
    });
  }

  // Other words, not other spellings: no half credit (D1), no contraction equivalence (D18), no
  // sound-alikes (D3).
  const staysWrong = [
    ['he hath spoken', 'he has spoken'],
    ['God spake these words', 'God spoke these words'],
    ['ye are the light', 'you are the light'],
    ['I do not know', "I don't know"],
    ["I don't know", 'I do not know'],
    ['And lo a voice', 'And low a voice'],
    ['they forgat his works', 'they forget his works'],
    ['stablish you', 'establish you'],
    ['And builded an altar', 'And built an altar'],
    ['mine eyes are unto thee', 'my eyes are unto thee'],
    ['God commendeth his love', 'God commended his love'],
    ['to him pertained', 'to him pertain'],
    ['Joab, Though I should receive', 'Job, though I should receive'],
  ] as const;
  for (const [expected, transcript] of staysWrong) {
    it(`stays wrong: ${expected} / ${transcript}`, () => assertNotEquivalent(expected, transcript));
  }
});

describe('alignTranscription — number grammar', () => {
  const pairs: [string, string, boolean][] = [
    ['two thousand and four hundred shekels', '2,400 shekels', true],
    ['two thousand and four hundred shekels', '2400 shekels', true],
    ['six hundred thousand and three thousand and five hundred and fifty men', '600,000 and 3,550 men', true],
    ['were an hundred thousand and fourscore thousand and six thousand and four hundred,', 'were 100,000 and fourscore thousand and 6,400,', true],
    ['four and twenty, six on each hand', '4 and 20, 6 on each hand', true],
    ['an hundred and twenty years', '120 years', true],
    ['were an hundred and thirty and seven years', 'were 137 years', true],
    // F5: the scale word covers the sum (Revelation 7:4, Numbers 25:9, Numbers 1:23)
    ['and there were sealed an hundred and forty and four thousand of all the tribes', 'and there were sealed 144,000 of all the tribes', true],
    ['And those that died in the plague were twenty and four thousand.', 'And those that died in the plague were 24,000.', true],
    ['were fifty and nine thousand and three hundred.', 'were 59,300.', true],
    ['an hundred and forty and four thousand', '145,000', false],
    ['two hundred men', '2 hundred men', true], // F1
    ['2 hundred men', 'two hundred men', true],
    ['two hundred men', '3 hundred men', false],
    ['25', 'five; and twenty', false], // F2: punctuation ends a number
    ['37', 'thirty, and seven', false],
    ['137', 'an hundred and thirty," and seven', false],
    ['five and twenty', 'twenty five', false], // F4: another wording said aloud
    ['twelve', '10 and 2', false], // F9: digits for another reading, not another spelling
    ['twelve tribes', '10 and 2 tribes', false],
    ['twenty-five', '20 and 5', false],
    ['forty-two', '40 and 2', false],
    ['three hundred thousand and seven and thirty thousand and five hundred sheep', '300,000 and 7 and 30,000 and 500 sheep', true],
    ['ten and two', 'twelve', false],
    ['one fourth part', 'a quarter part', false],
    ['three fourths', 'three quarters', false],
    ['a quarter part', '1/4 part', true],
    ['three quarters', '3/4', true],
    ['Beth-lehem, an hundred twenty and three.', 'Beth-lehem, 123.', true],
    ['were an hundred and thirty and seven years', 'were 138 years', false],
    ['thirty and seven', '36', false],
    ['an hundred and twenty years', 'a hundred and twenty years', true],
    ['an hundred and twenty years', 'and hundred and twenty years', true],
    ['slew a thousand men', 'slew 1,000 men', true],
    ['six hundred thousand', '600 thousand', true],
    ['The eleven hundred shekels', 'The 1,100 shekels', true],
    ['some an hundredfold', 'some a 100-fold', true],
    ['avenged sevenfold', 'avenged 7-fold', true],
    ['a thousand seven hundred and threescore and fifteen', 'a thousand seven hundred and three score and fifteen', true],
    ['Five and twenty years old was he', '25 years old was he', true],
    ['in the seven and twentieth year', 'in the 27th year', true],
    ['two thousand and four hundred', '2,004', false],
    ['two thousand and four hundred', '2,400 and 4', false],
    ['a thousand', '1,001', false],
    ['an hundred', '101', false],
    ['a man', '1 man', false],
    ['seventy, two', '72', false],
    ['six hundred thousand', '600 thousand thousand', false],
    ['seventy-two', '7 2', false],
    ['sevenfold', '70-fold', false],
    ['an hundredfold', 'sixtyfold', false],
    ['three hundred thousand and seven thousand', '300,007 thousand', false],
    ['one hundred', 'a hundred and one', false],
    ['the twelve', 'the 12 thousand', false],
  ];
  for (const [expected, transcript, same] of pairs) {
    it(`${same ? '=' : '≠'} ${expected} | ${transcript}`, () =>
      (same ? assertEquivalent : assertNotEquivalent)(expected, transcript));
  }
});

describe('alignTranscription — fractions', () => {
  const pairs: [string, string, boolean][] = [
    ['it weighed 3-1/4 pounds.', 'it weighed three and one fourth pounds.', true],
    ['it weighed 3-1/4 pounds.', 'it weighed three and a quarter pounds.', true],
    ['it weighed 3-1/4 pounds.', 'it weighed 3 1/4 pounds.', true],
    ['it was 1-1/2 feet long', 'it was one and a half feet long', true],
    ['it was 2-3/4 feet long', 'it was two and three quarters feet long', true],
    ['it was 1/2 inch thick', 'it was one half inch thick', true],
    ['it was 1/3 of a shekel', 'it was one third of a shekel', true],
    ['it weighed 3-1/4 pounds.', 'it weighed three and one half pounds.', false],
    ['it weighed 3-1/4 pounds.', 'it weighed three pounds.', false],
    ['he sent a third time', 'he sent a 3rd time', true],
    ['two cubits and a half was the length', 'two cubits and a half was the length', true],
  ];
  for (const [expected, transcript, same] of pairs) {
    it(`${same ? '=' : '≠'} ${expected} | ${transcript}`, () =>
      (same ? assertEquivalent : assertNotEquivalent)(expected, transcript));
  }
});

describe('alignTranscription — compounds and slips', () => {
  const equivalent = [
    ['Forasmuch as God hath shewed thee', 'for as much as God hath showed thee'],
    ['Nevertheless the people be strong', 'never the less the people be strong'],
    ['to reconcile withal in the holy place', 'to reconcile with all in the holy place'],
    ['they were altogether become filthy', 'they were all together become filthy'],
    ['children of Israel for ever: for in six days', 'children of Israel forever for in six days'],
    ['and\u200Bthe', 'and the'], // zero-width space between words
  ] as const;
  for (const [expected, transcript] of equivalent) {
    it(`${expected} = ${transcript}`, () => {
      assertEquivalent(expected, transcript);
      assertEquivalent(transcript, expected);
    });
  }

  // D9: a restart costs the repeated words, nothing more.
  it('a restart costs exactly the repeated words', () => {
    const alignment = alignTranscription('For God so loved the world', 'For God so loved for God so loved the world');
    assert.equal(alignment.filter((w) => w.status === 'correct').length, 6);
    assert.equal(alignment.filter((w) => w.status === 'added').length, 4);
    assert.equal(alignment.filter((w) => w.status === 'missing').length, 0);
    assert.equal(calculateChunkScore(alignment), 60);
  });

  it('one stutter beside "to day" and "for ever" costs only itself', () => {
    const alignment = alignTranscription('Jesus Christ the same yesterday, and to day, and for ever.', 'Jesus Christ the same yesterday and and today and forever');
    assert.ok(calculateChunkScore(alignment) >= 90, JSON.stringify(alignment));
  });

  it('one stray word inside a number costs only itself (Nehemiah 7:38)', () => {
    const alignment = alignTranscription(
      'The children of Senaah, three thousand nine hundred and thirty.',
      'The children of Senaah, three thousand so nine hundred and thirty.',
    );
    assert.ok(calculateChunkScore(alignment) >= 90, JSON.stringify(alignment));
  });
});
