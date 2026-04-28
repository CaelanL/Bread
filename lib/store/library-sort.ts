/**
 * Library sort: pure helpers + AsyncStorage-backed sort preference for
 * the Mastered and In Progress virtual collections.
 *
 * "Recent" sort means **last practiced** descending. Verses without a
 * `lastPracticedAt` (never practiced) sort *after* practiced ones, by
 * `createdAt` descending among themselves. See
 * docs/features/library-sort-persistence-and-last-practiced.md for
 * the full design.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  formatVerseReference,
  parseSortPreference,
  type SavedVerse,
  type SortOption,
} from '@/lib/storage';
import { daysUntilDue } from '@/lib/store/review';

export const LIBRARY_SORT_MASTERED_KEY = 'library_sort_mastered';
export const LIBRARY_SORT_IN_PROGRESS_KEY = 'library_sort_in_progress';

/**
 * Cycle order:
 *   non-Mastered: recent → alphabetical → mastery → recent
 *   Mastered:     recent → alphabetical → mastery → due-first → recent
 */
export function cycleSort(current: SortOption, isMastered: boolean): SortOption {
  switch (current) {
    case 'recent':
      return 'alphabetical';
    case 'alphabetical':
      return 'mastery';
    case 'mastery':
      return isMastered ? 'due-first' : 'recent';
    case 'due-first':
      return 'recent';
    default:
      return 'recent';
  }
}

export function getSortLabel(sort: SortOption): string {
  switch (sort) {
    case 'recent':
      return 'Recent';
    case 'alphabetical':
      return 'A-Z';
    case 'mastery':
      return 'Mastery';
    case 'due-first':
      return 'Due first';
  }
}

/**
 * Sort verses in-place-safe (returns a new array). `now` is required
 * for `due-first` so callers can pass `useReviewNow()` and benefit from
 * the existing focus-aware tick.
 *
 * The Recent comparator places never-practiced verses after practiced
 * ones, then orders them by `createdAt` desc among themselves.
 * The Due-First comparator preserves the existing `createdAt` desc
 * tiebreaker for verses with the same `daysUntilDue`.
 */
export function sortVerses(
  verses: SavedVerse[],
  sort: SortOption,
  now: Date,
): SavedVerse[] {
  const sorted = [...verses];
  switch (sort) {
    case 'alphabetical':
      return sorted.sort((a, b) =>
        formatVerseReference(a).localeCompare(formatVerseReference(b)),
      );
    case 'mastery': {
      const level = (v: SavedVerse) => {
        if (v.progress.engraved?.completed) return 4;
        if (v.progress.hard.completed) return 3;
        if (v.progress.medium.completed) return 2;
        if (v.progress.easy.completed) return 1;
        return 0;
      };
      return sorted.sort((a, b) => level(b) - level(a));
    }
    case 'due-first':
      return sorted.sort((a, b) => {
        const da = daysUntilDue(a, now);
        const db = daysUntilDue(b, now);
        if (da !== db) return da - db;
        return b.createdAt - a.createdAt;
      });
    case 'recent':
    default:
      return sorted.sort((a, b) => {
        const la = a.lastPracticedAt ? Date.parse(a.lastPracticedAt) : NaN;
        const lb = b.lastPracticedAt ? Date.parse(b.lastPracticedAt) : NaN;
        const aHas = !Number.isNaN(la);
        const bHas = !Number.isNaN(lb);
        if (aHas && bHas) return lb - la;
        if (aHas) return -1;
        if (bHas) return 1;
        return b.createdAt - a.createdAt;
      });
  }
}

// ============ AsyncStorage helpers (virtual collections) ============

export async function getMasteredSort(): Promise<SortOption | undefined> {
  const raw = await AsyncStorage.getItem(LIBRARY_SORT_MASTERED_KEY);
  return parseSortPreference(raw);
}

export async function setMasteredSort(sort: SortOption): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_SORT_MASTERED_KEY, sort);
}

export async function getInProgressSort(): Promise<SortOption | undefined> {
  const raw = await AsyncStorage.getItem(LIBRARY_SORT_IN_PROGRESS_KEY);
  return parseSortPreference(raw);
}

export async function setInProgressSort(sort: SortOption): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_SORT_IN_PROGRESS_KEY, sort);
}
