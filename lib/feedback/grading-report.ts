// lib-ok: The one builder of a grading report's payload, so its licensing rule is tested in one place.
import type { BibleVersion } from '@/lib/storage';
import type { AlignmentWord, Difficulty } from '@/lib/study-chunks';
import type { ChunkResult } from '@/lib/transcription/score-recording';

/** Which result the card showed: the one that counts, a retry, or a revealed chunk's recitation. */
export type ShownResult = 'scored' | 'retry' | 'peeked';

interface GradingReportInput {
  verse: { book: string; chapter: number; verseStart: number; verseEnd: number; version: BibleVersion };
  chunk: { verseNum: number; verseNumEnd?: number };
  difficulty: Difficulty;
  chunkSize: number;
  result: ChunkResult;
  shown: ShownResult;
}

/** `i` is the word's position in the verse; added words have none. */
interface ReportedWord {
  i?: number;
  status: AlignmentWord['status'];
  word?: string;
  expected?: string;
}

// Only public-domain verse words may be stored (invariant 2). Otherwise a verse word keeps its
// position and result, and only an added word keeps what was said.
function reportWords(alignment: AlignmentWord[], keepVerseWords: boolean): ReportedWord[] {
  let position = 0;
  return alignment.map(({ word, status, expected }) => {
    if (status === 'added') return { status, word };
    const entry: ReportedWord = { i: position++, status };
    if (keepVerseWords) {
      entry.word = word;
      if (expected) entry.expected = expected;
    }
    return entry;
  });
}

export function buildGradingReport({ verse, chunk, difficulty, chunkSize, result, shown }: GradingReportInput) {
  return {
    reference: { book: verse.book, chapter: verse.chapter, verseStart: verse.verseStart, verseEnd: verse.verseEnd },
    translation: verse.version,
    chunkVerses: { start: chunk.verseNum, end: chunk.verseNumEnd ?? chunk.verseNum },
    difficulty,
    chunkSize,
    shown,
    transcript: result.transcription,
    words: reportWords(result.alignment, verse.version === 'KJV'),
    score: result.score,
    recording: result.recording ?? null,
  };
}

export type GradingReport = ReturnType<typeof buildGradingReport>;
