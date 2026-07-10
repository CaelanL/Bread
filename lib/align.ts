import { diffWords } from 'diff';
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
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return words.map(raw => ({
    raw,
    normalized: normalize(raw),
  }));
}

/**
 * Normalize a single word:
 * - lowercase
 * - strip leading/trailing punctuation
 * - keep internal apostrophes and hyphens
 */
function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^\w']+/, '')  // strip leading non-word chars (except apostrophe)
    .replace(/[^\w']+$/, ''); // strip trailing non-word chars (except apostrophe)
}

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
  const transcribedTokens = tokenize(cleanedTranscription);

  // Join normalized tokens for diffing
  const expectedNormalized = expectedTokens.map(t => t.normalized).join(' ');
  const transcribedNormalized = transcribedTokens.map(t => t.normalized).join(' ');

  // Run diff on normalized strings
  const diffResult = diffWords(expectedNormalized, transcribedNormalized);

  // Walk through diff result and consume from token arrays
  const alignment: AlignmentWord[] = [];
  let expectedIdx = 0;
  let transcribedIdx = 0;

  for (const part of diffResult) {
    // Count words in this diff part
    const words = part.value.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    if (part.removed) {
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
