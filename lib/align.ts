import { diffArrays } from 'diff';
import type { AlignmentWord } from './study-chunks';

interface Token {
  raw: string;
  normalized: string;
}

/**
 * Tokenize a string into an array of tokens with raw and normalized forms.
 * - raw: original word with punctuation and casing
 * - normalized: lowercase, leading/trailing punctuation stripped, internal apostrophes/hyphens kept
 */
function tokenize(text: string): Token[] {
  return text
    .replace(/([—–])/g, '$1 ') // em/en dash joins two words ("world—and") — split them
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(raw => ({ raw, normalized: normalize(raw) }))
    .filter(t => t.normalized.length > 0); // drop punctuation-only tokens (e.g. a bare "—")
}

/**
 * Normalize a single word:
 * - lowercase
 * - drop apostrophes (curly or straight) and hyphens: possessive vs
 *   plural ("eagle's"/"eagles") and hyphenation ("Beth-lehem"/
 *   "Bethlehem") are acoustically identical, so ASR output can't be
 *   penalized for the difference
 * - strip leading/trailing punctuation
 * - fold vocative "O" to "oh" (KJV has 1,000+ "O LORD"s; ASR hears "oh")
 */
function normalize(word: string): string {
  const n = word
    .toLowerCase()
    .replace(/[’‘'-]/g, '')
    .replace(/^[^\w]+/, '')
    .replace(/[^\w]+$/, '');
  return n === 'o' ? 'oh' : n;
}

// Hesitation sounds an ASR may transcribe. Dropped from the TRANSCRIPT
// side only, and deliberately excludes tokens that occur in scripture:
// "Ah" (Jer 1:6 etc.) and "Er" (a name, Gen 38).
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'hmm', 'hm', 'mm', 'mmm', 'mhm']);

/**
 * Align a cleaned transcription against an expected verse.
 * Returns an array of AlignmentWord objects for rendering.
 *
 * @param expectedVerse - The original verse text (with punctuation/caps)
 * @param cleanedTranscription - The LLM-cleaned transcription
 * @returns Array of alignment words with status: correct, missing, added
 */
export function alignTranscription(
  expectedVerse: string,
  cleanedTranscription: string
): AlignmentWord[] {
  const expectedTokens = tokenize(expectedVerse);
  const transcribedTokens = tokenize(cleanedTranscription).filter(
    t => !FILLERS.has(t.normalized)
  );

  // Diff over normalized token arrays so each diff part maps 1:1 to tokens.
  // (diffWords on joined strings split inside words at dashes/apostrophes,
  // producing punctuation-only parts that desynced the token walk below.)
  const diffResult = diffArrays(
    expectedTokens.map(t => t.normalized),
    transcribedTokens.map(t => t.normalized)
  );

  // Walk through diff result and consume from token arrays
  const alignment: AlignmentWord[] = [];
  let expectedIdx = 0;
  let transcribedIdx = 0;

  for (let p = 0; p < diffResult.length; p++) {
    const part = diffResult[p];
    const wordCount = part.value.length;

    if (part.removed) {
      // A removed run followed by an added run is a substitution region.
      // Check it for split/joined compounds ("for ever" ↔ "forever",
      // "forty-two" ↔ "forty two") before flagging words wrong.
      const next = diffResult[p + 1];
      if (next?.added) {
        const removed = expectedTokens.slice(expectedIdx, expectedIdx + wordCount);
        const added = transcribedTokens.slice(transcribedIdx, transcribedIdx + next.value.length);
        alignSubstitution(removed, added, alignment);
        expectedIdx += removed.length;
        transcribedIdx += added.length;
        p++; // consumed the added part too
        continue;
      }
      // Words in expected but not in transcribed → missing
      for (let i = 0; i < wordCount && expectedIdx < expectedTokens.length; i++) {
        const token = expectedTokens[expectedIdx++];
        alignment.push({
          word: token.raw,
          status: 'missing',
          expected: token.raw,
        });
      }
    } else if (part.added) {
      // Words in transcribed but not in expected → added
      for (let i = 0; i < wordCount && transcribedIdx < transcribedTokens.length; i++) {
        const token = transcribedTokens[transcribedIdx++];
        alignment.push({
          word: token.raw.toLowerCase(),
          status: 'added',
        });
      }
    } else {
      // Equal - words match → correct
      for (let i = 0; i < wordCount; i++) {
        if (expectedIdx < expectedTokens.length) {
          const token = expectedTokens[expectedIdx++];
          alignment.push({
            word: token.raw,
            status: 'correct',
          });
        }
        // Also advance transcribed index to stay in sync
        if (transcribedIdx < transcribedTokens.length) {
          transcribedIdx++;
        }
      }
    }
  }

  // Handle any remaining expected tokens (user stopped early)
  while (expectedIdx < expectedTokens.length) {
    const token = expectedTokens[expectedIdx++];
    alignment.push({
      word: token.raw,
      status: 'missing',
      expected: token.raw,
    });
  }

  // Handle any remaining transcribed tokens (user said extra at end)
  while (transcribedIdx < transcribedTokens.length) {
    const token = transcribedTokens[transcribedIdx++];
    alignment.push({
      word: token.raw.toLowerCase(),
      status: 'added',
    });
  }

  return alignment;
}

/**
 * Resolve a substitution region (expected tokens the diff removed vs
 * transcribed tokens it added). Words that only differ in how they're
 * split ("for ever" ↔ "forever") are spoken identically, so greedily
 * match runs whose normalized concatenations are equal and mark the
 * expected words correct. Anything unmatched falls through to the
 * normal missing/added statuses.
 */
function alignSubstitution(
  removed: Token[],
  added: Token[],
  alignment: AlignmentWord[]
): void {
  let a = 0;
  let b = 0;
  while (a < removed.length && b < added.length) {
    // Grow whichever concatenation is a prefix of the other until they
    // meet. Equal single tokens can't occur here (the diff would have
    // matched them), so any hit is a genuine split/join.
    let i = a, j = b;
    let exp = removed[i].normalized;
    let got = added[j].normalized;
    while (exp !== got) {
      if (got.startsWith(exp) && i + 1 < removed.length) {
        exp += removed[++i].normalized;
      } else if (exp.startsWith(got) && j + 1 < added.length) {
        got += added[++j].normalized;
      } else {
        break;
      }
    }
    if (exp === got) {
      for (let k = a; k <= i; k++) {
        alignment.push({ word: removed[k].raw, status: 'correct' });
      }
      a = i + 1;
      b = j + 1;
    } else {
      alignment.push({ word: removed[a].raw, status: 'missing', expected: removed[a].raw });
      a++;
    }
  }
  while (a < removed.length) {
    alignment.push({ word: removed[a].raw, status: 'missing', expected: removed[a].raw });
    a++;
  }
  while (b < added.length) {
    alignment.push({ word: added[b].raw.toLowerCase(), status: 'added' });
    b++;
  }
}

/**
 * Build an alignment where every word of the expected verse is missing,
 * as if the user said nothing. Used for "peeked" chunks: revealing the
 * answer before reciting zeroes that chunk's contribution to the score.
 *
 * Reuses the same tokenizer as alignTranscription (via the empty-string
 * transcription path) so the word count stays consistent with normal
 * scoring.
 */
export function buildAllMissingAlignment(expectedVerse: string): AlignmentWord[] {
  return alignTranscription(expectedVerse, '');
}
