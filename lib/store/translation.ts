// lib-ok: Pure rules for one verse per reference across translations, shared by the store and its tests.
import type { VerseProgress } from '@/lib/storage';

export interface VerseRecord {
  id: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: string;
  progress: VerseProgress;
  deleted: boolean;
}

type Reference = Pick<VerseRecord, 'book' | 'chapter' | 'verseStart' | 'verseEnd'>;

export function referenceKey({ book, chapter, verseStart, verseEnd }: Reference): string {
  return `${book} ${chapter}:${verseStart}-${verseEnd}`;
}

function progressRank(p: VerseProgress): number[] {
  const completed = [p.easy, p.medium, p.hard].filter((d) => d?.completed).length;
  return [p.hard?.completed ? 1 : 0, p.engraved?.passCount ?? 0, completed];
}

/**
 * Better row first: mastered beats learning, then higher passCount, then more
 * completed difficulties. Ties go to the active row, then the one already in
 * the account translation, then the lower id so every device picks the same row.
 */
export function compareRecords(translation: string) {
  return (a: VerseRecord, b: VerseRecord): number => {
    const ra = progressRank(a.progress);
    const rb = progressRank(b.progress);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return rb[i] - ra[i];
    }
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
    if ((a.version === translation) !== (b.version === translation)) return a.version === translation ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

// Active rows, and soft-deleted mastered rows, which stay in the Mastered list.
export function isVisible(record: VerseRecord): boolean {
  return !record.deleted || record.progress.hard?.completed === true;
}

function groupByReference<T extends VerseRecord>(records: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = referenceKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()];
}

/**
 * Every reference held active more than once, with the row that keeps it. The losers
 * are deleted for good. Soft-deleted rows never take part, so a verse the user reset
 * or removed is never replaced by an older twin.
 */
export function planCollapse<T extends VerseRecord>(records: T[], translation: string): { winner: T; losers: T[] }[] {
  return groupByReference(records.filter((record) => !record.deleted))
    .filter((group) => group.length > 1)
    .map((group) => {
      const [winner, ...losers] = [...group].sort(compareRecords(translation));
      return { winner, losers };
    });
}

/**
 * Version changes that put each reference in `translation`. Only one row per reference
 * moves: the active one, else the best soft-deleted one. A row already holding
 * `translation` takes the mover's old version, so no two rows of a reference ever share
 * a version (older app versions look a verse up by reference and version, expecting one).
 * Rows `keep` says stay put (the translation leaves them out) don't move.
 */
export function planMoves<T extends VerseRecord>(
  records: T[],
  translation: string,
  keep: (record: T) => boolean = () => false,
): { id: string; version: string }[] {
  const moves: { id: string; version: string }[] = [];
  for (const group of groupByReference(records)) {
    const [mover] = [...group].sort((a, b) => Number(a.deleted) - Number(b.deleted) || compareRecords(translation)(a, b));
    if (mover.version === translation || keep(mover)) continue;
    const holder = group.find((record) => record.version === translation);
    if (holder) moves.push({ id: holder.id, version: mover.version });
    moves.push({ id: mover.id, version: translation });
  }
  return moves;
}

/**
 * The translation for an account that has none yet: the one most of its active verses
 * are in, so nothing moves. With no active verses, this device's choice.
 */
export function seedTranslation<V extends string>(records: VerseRecord[], fallback: V, known: (value: string) => value is V): V {
  const counts = new Map<V, number>();
  for (const { version, deleted } of records) {
    if (!deleted && known(version)) counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  let best = fallback;
  for (const [version, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = version;
  }
  return best;
}

/** The best row of each reference, in input order. */

export function onePerReference<T extends VerseRecord>(records: T[], translation: string): T[] {
  const compare = compareRecords(translation);
  const best = new Map<string, T>();
  for (const record of records) {
    const key = referenceKey(record);
    const current = best.get(key);
    if (!current || compare(record, current) < 0) best.set(key, record);
  }
  return records.filter((record) => best.get(referenceKey(record)) === record);
}

// Verses that ESV, NIV and NLT leave out of the main text. A held range touching
// one is read in the target translation before it moves there.
const OMITTED_IN_SOME_TRANSLATIONS: Record<string, number[]> = {
  'Matthew 12': [47],
  'Matthew 17': [21],
  'Matthew 18': [11],
  'Matthew 23': [14],
  'Mark 7': [16],
  'Mark 9': [44, 46],
  'Mark 11': [26],
  'Mark 15': [28],
  'Luke 17': [36],
  'Luke 23': [17],
  'John 5': [4],
  'Acts 8': [37],
  'Acts 15': [34],
  'Acts 24': [7],
  'Acts 28': [29],
  'Romans 16': [24],
};

export function mayBeMissing({ book, chapter, verseStart, verseEnd }: Reference): boolean {
  return (OMITTED_IN_SOME_TRANSLATIONS[`${book} ${chapter}`] ?? [])
    .some((verse) => verse >= verseStart && verse <= verseEnd);
}
