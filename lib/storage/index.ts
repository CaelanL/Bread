/**
 * Storage Layer
 *
 * Supabase is the source of truth. No AsyncStorage for user data.
 * All reads/writes go directly to the server.
 */

import { supabase } from '@/lib/api/client';
import { ensureAuth } from '@/lib/api';
import { isCollectionIconKey, type CollectionIconKey } from '@/lib/collections/icons';
import { ENGRAVED_THRESHOLD } from '@/lib/store/review-config';

// ============ TYPES ============

export type SortOption = 'recent' | 'alphabetical' | 'mastery' | 'due-first';

export const DEFAULT_SORT: SortOption = 'recent';

export interface DifficultyProgress {
  bestAccuracy: number | null;
  completed: boolean; // true if bestAccuracy >= 90
}

export interface EngravedProgress {
  completed: boolean; // true once passCount >= ENGRAVED_THRESHOLD
  passCount: number; // monotonic; advances on each on-time qualifying review
  lifetimeReviews: number; // every qualifying Hard ≥90% session, on-time or early
  nextDueAt: string | null; // ISO UTC of local-midnight due moment; null until first qualifying review
  lastReviewedAt: string | null; // ISO UTC of last qualifying review
  // Legacy "YYYY-MM" streak array. Preserved through the App Store rollout
  // window so old clients keep reading; new clients ignore on read after
  // parseProgress derives passCount, and never write it. Dropped by a
  // follow-up cleanup migration.
  months?: string[];
}

export interface VerseProgress {
  easy: DifficultyProgress;
  medium: DifficultyProgress;
  hard: DifficultyProgress;
  engraved?: EngravedProgress; // Optional for backwards compatibility
}

export type BibleVersion = 'ESV' | 'NLT' | 'NIV' | 'NKJV' | 'KJV';

export interface SavedVerse {
  id: string;
  collectionId: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  text?: string; // Optional - combined text fetched on demand
  verses?: Record<string, string>; // Optional - keyed data for annotated display
  version: BibleVersion;
  createdAt: number;
  progress: VerseProgress;
  lastPracticedAt?: string; // ISO UTC of last completed session (any difficulty)
  lastChunkSize?: number; // Last chunk size chosen on the setup screen
  lastDifficulty?: Difficulty; // Last difficulty chosen on the setup screen
}

export interface Collection {
  id: string;
  name: string;
  isDefault: boolean;
  isVirtual?: boolean; // Virtual collections (like Mastered) can't be deleted or have verses manually added
  icon?: string; // SF Symbol name
  iconKey?: CollectionIconKey;
  iconColor?: string; // Hex color for icon
  createdAt: number;
  sortPreference?: SortOption; // Per-collection sort, NULL = default
  sharedId?: string; // shared_collections.id when this is a member's copy of a shared collection
}

export type SharedRole = 'owner' | 'editor' | 'member';

/** One shared collection the user belongs to, from shared_collections and get_shared_status(). */
export interface SharedCollectionInfo {
  id: string;
  /** The owner's display name for a group you joined; null for your own (read `displayName`) or when it couldn't be read. */
  ownerName: string | null;
  name: string;
  role: SharedRole;
  memberCount: number;
  verseCount: number;
  masteredSquares: number;
  engravedSquares: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

// ============ CONSTANTS ============

const DEFAULT_COLLECTION_ID = 'my-verses';

export const DEFAULT_PROGRESS: VerseProgress = {
  easy: { bestAccuracy: null, completed: false },
  medium: { bestAccuracy: null, completed: false },
  hard: { bestAccuracy: null, completed: false },
  engraved: {
    completed: false,
    passCount: 0,
    lifetimeReviews: 0,
    nextDueAt: null,
    lastReviewedAt: null,
    months: [],
  },
};

/**
 * Defensive parser for the `engraved` JSONB sub-object. Tolerates:
 *  - Pre-migration rows (legacy `months` only) — derives passCount from
 *    months.length, lifetimeReviews from the same.
 *  - Post-migration rows with the new fields — uses them directly.
 *  - Old clients overwriting a new-shape row (drops new fields) — re-derives
 *    on next read so SR resumes at the legacy month-based count.
 *  - Malformed JSONB (null, non-object) — returns the default shape.
 *
 * `completed` is preserved if it was true (don't silently un-engrave a
 * pre-engraved user); otherwise derived from passCount.
 */
export function parseEngravedProgress(raw: unknown): EngravedProgress {
  const e = (raw && typeof raw === 'object') ? raw as Partial<EngravedProgress> : {};
  const months = Array.isArray(e.months) ? e.months : [];
  const passCount = typeof e.passCount === 'number' ? e.passCount : months.length;
  const lifetimeReviews = typeof e.lifetimeReviews === 'number' ? e.lifetimeReviews : months.length;
  const completed = e.completed === true || passCount >= ENGRAVED_THRESHOLD;
  return {
    completed,
    passCount,
    lifetimeReviews,
    nextDueAt: typeof e.nextDueAt === 'string' ? e.nextDueAt : null,
    lastReviewedAt: typeof e.lastReviewedAt === 'string' ? e.lastReviewedAt : null,
    months,
  };
}

function parseLastDifficulty(raw: unknown): Difficulty | undefined {
  return raw === 'easy' || raw === 'medium' || raw === 'hard' ? raw : undefined;
}

/**
 * Map the nullable per-verse columns added after the original schema
 * (016 `last_practiced_at`, 021 study prefs). Shared by every
 * user_verses row → SavedVerse mapper so adding a column is one edit,
 * not five. Defensive: tolerates missing columns (un-migrated DB)
 * and NULLs.
 */
export function parseVerseRowExtras(row: {
  last_practiced_at?: unknown;
  last_chunk_size?: unknown;
  last_difficulty?: unknown;
}): Pick<SavedVerse, 'lastPracticedAt' | 'lastChunkSize' | 'lastDifficulty'> {
  return {
    lastPracticedAt: typeof row.last_practiced_at === 'string'
      ? row.last_practiced_at
      : undefined,
    lastChunkSize: typeof row.last_chunk_size === 'number'
      ? row.last_chunk_size
      : undefined,
    lastDifficulty: parseLastDifficulty(row.last_difficulty),
  };
}

export function parseProgress(raw: unknown): VerseProgress {
  const p = (raw && typeof raw === 'object') ? raw as Partial<VerseProgress> : {};
  return {
    easy: p.easy ?? { bestAccuracy: null, completed: false },
    medium: p.medium ?? { bestAccuracy: null, completed: false },
    hard: p.hard ?? { bestAccuracy: null, completed: false },
    engraved: parseEngravedProgress(p.engraved),
  };
}

export function parseCollectionRow(row: {
  client_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  sort_preference?: unknown;
  icon_key?: unknown;
  shared_collection_id?: string | null;
}): Collection {
  return {
    id: row.client_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at).getTime(),
    sortPreference: parseSortPreference(row.sort_preference),
    iconKey: !row.is_default && isCollectionIconKey(row.icon_key) ? row.icon_key : undefined,
    sharedId: row.shared_collection_id ?? undefined,
  };
}

export const MASTERED_COLLECTION_ID = 'mastered';
export const IN_PROGRESS_COLLECTION_ID = 'in-progress';

// ============ HELPERS ============

async function getCurrentUserId(): Promise<string> {
  await ensureAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ============ VERSE FUNCTIONS ============

/**
 * Remember the study setup (chunk size + difficulty) the user chose for
 * a verse. Preference write, fire-and-forget: callers don't surface
 * failures — a lost write just means the setup screen falls back to
 * defaults next time.
 */
export async function updateVerseStudyPrefs(
  id: string,
  chunkSize: number,
  difficulty: Difficulty
): Promise<void> {
  const { error } = await supabase
    .from('user_verses')
    .update({ last_chunk_size: chunkSize, last_difficulty: difficulty })
    .eq('client_id', id);

  if (error) {
    console.error('[STORAGE] Failed to save study prefs:', error);
  }
}

// ============ SORT PREFERENCE (per-collection) ============

const VALID_SORTS: readonly SortOption[] = ['recent', 'alphabetical', 'mastery', 'due-first'] as const;

/**
 * Defensive parser for the `sort_preference` column. Tolerates NULL,
 * unrecognized values, and pre-migration rows (column missing → undefined).
 * Returns undefined when the value is unknown so callers fall back to
 * DEFAULT_SORT.
 */
export function parseSortPreference(raw: unknown): SortOption | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_SORTS.includes(raw as SortOption) ? (raw as SortOption) : undefined;
}

/**
 * Persist a per-collection sort preference. The default `my-verses`
 * collection is lazy-created on first verse add; if the user cycles
 * the sort *before* their first verse, the row doesn't exist yet —
 * we lazy-create it here so the preference survives app restart.
 *
 * Virtual collections (Mastered, In Progress) never reach this
 * function — `setCollectionSort` in the store routes them to the
 * AsyncStorage helpers in `lib/store/library-sort.ts`.
 */
export async function updateCollectionSort(
  collectionId: string,
  sort: SortOption,
): Promise<void> {
  // Use .select() so we can detect zero-row updates (the default
  // collection's row may not exist yet for users with no verses).
  const { data, error } = await supabase
    .from('user_collections')
    .update({ sort_preference: sort })
    .eq('client_id', collectionId)
    .select('id');

  if (error) {
    console.error('[STORAGE] Failed to update collection sort:', error);
    throw new Error('Failed to save sort preference');
  }

  // If the UPDATE matched a row, we're done.
  if (data && data.length > 0) return;

  // Zero rows matched. Only the default collection can legitimately
  // be missing from the DB (lazy-created on first verse add). For any
  // other collection, this is a stale ID — surface as an error rather
  // than silently inserting a row.
  if (collectionId !== DEFAULT_COLLECTION_ID) {
    console.warn(`[STORAGE] updateCollectionSort: no row matched for ${collectionId}`);
    return;
  }

  // Lazy-create the default collection with the chosen sort.
  const userId = await getCurrentUserId();
  const { error: insertError } = await supabase
    .from('user_collections')
    .insert({
      user_id: userId,
      client_id: DEFAULT_COLLECTION_ID,
      name: 'My Verses',
      is_default: true,
      sort_preference: sort,
      created_at: new Date(0).toISOString(),
    });

  if (insertError) {
    console.error('[STORAGE] Failed to lazy-create default collection:', insertError);
    throw new Error('Failed to save sort preference');
  }
}

// ============ UTILITY FUNCTIONS ============

export function formatVerseReference(verse: Pick<SavedVerse, 'book' | 'chapter' | 'verseStart' | 'verseEnd'>): string {
  if (verse.verseStart === verse.verseEnd) {
    return `${verse.book} ${verse.chapter}:${verse.verseStart}`;
  }
  return `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`;
}
