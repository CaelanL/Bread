/**
 * Storage Layer
 *
 * Supabase is the source of truth. No AsyncStorage for user data.
 * All reads/writes go directly to the server.
 */

import { supabase } from '@/lib/api/client';
import { ensureAuth } from '@/lib/api';
import { ENGRAVED_THRESHOLD } from '@/lib/store/review-config';

// ============ TYPES ============

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
}

export interface Collection {
  id: string;
  name: string;
  isDefault: boolean;
  isVirtual?: boolean; // Virtual collections (like Mastered) can't be deleted or have verses manually added
  icon?: string; // SF Symbol name
  iconColor?: string; // Hex color for icon
  createdAt: number;
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

export function parseProgress(raw: unknown): VerseProgress {
  const p = (raw && typeof raw === 'object') ? raw as Partial<VerseProgress> : {};
  return {
    easy: p.easy ?? { bestAccuracy: null, completed: false },
    medium: p.medium ?? { bestAccuracy: null, completed: false },
    hard: p.hard ?? { bestAccuracy: null, completed: false },
    engraved: parseEngravedProgress(p.engraved),
  };
}

const DEFAULT_COLLECTION: Collection = {
  id: DEFAULT_COLLECTION_ID,
  name: 'My Verses',
  isDefault: true,
  createdAt: 0,
};

export const MASTERED_COLLECTION_ID = 'mastered';
export const IN_PROGRESS_COLLECTION_ID = 'in-progress';

const MASTERED_COLLECTION: Collection = {
  id: MASTERED_COLLECTION_ID,
  name: 'Mastered',
  isDefault: false,
  isVirtual: true,
  icon: 'checkmark.circle.fill',
  iconColor: '#22c55e', // Green
  createdAt: 0,
};

const IN_PROGRESS_COLLECTION: Collection = {
  id: IN_PROGRESS_COLLECTION_ID,
  name: 'In Progress',
  isDefault: false,
  isVirtual: true,
  icon: 'circle.dotted',
  iconColor: '#f59e0b', // Amber
  createdAt: 0,
};

// ============ HELPERS ============

async function getCurrentUserId(): Promise<string> {
  await ensureAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ============ COLLECTION FUNCTIONS ============

/**
 * Get all collections from Supabase
 */
export async function getCollections(): Promise<Collection[]> {
  try {
    const { data, error } = await supabase
      .from('user_collections')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[STORAGE] Failed to fetch collections:', error);
      return [DEFAULT_COLLECTION];
    }

    const collections = data.map((c) => ({
      id: c.client_id,
      name: c.name,
      isDefault: c.is_default,
      createdAt: new Date(c.created_at).getTime(),
    }));

    // Ensure default collection always exists
    const hasDefault = collections.some((c) => c.isDefault);
    if (!hasDefault) {
      collections.unshift(DEFAULT_COLLECTION);
    }

    // Add Mastered + In Progress virtual collections after default
    const defaultIndex = collections.findIndex((c) => c.isDefault);
    collections.splice(defaultIndex + 1, 0, MASTERED_COLLECTION, IN_PROGRESS_COLLECTION);

    return collections;
  } catch (e) {
    console.error('[STORAGE] Collection fetch error:', e);
    return [DEFAULT_COLLECTION];
  }
}

/**
 * Create a collection in Supabase
 */
export async function createCollection(name: string): Promise<Collection> {
  const userId = await getCurrentUserId();
  const clientId = `collection-${Date.now()}`;
  const createdAt = new Date();

  const { error } = await supabase.from('user_collections').insert({
    user_id: userId,
    client_id: clientId,
    name,
    is_default: false,
    created_at: createdAt.toISOString(),
  });

  if (error) {
    console.error('[STORAGE] Failed to create collection:', error);
    throw new Error('Failed to create collection');
  }

  return {
    id: clientId,
    name,
    isDefault: false,
    createdAt: createdAt.getTime(),
  };
}

/**
 * Delete a collection (soft delete) and move verses to default
 */
export async function deleteCollection(id: string): Promise<void> {
  if (id === DEFAULT_COLLECTION_ID) return;

  // Get server UUID for this collection
  const { data: collection } = await supabase
    .from('user_collections')
    .select('id')
    .eq('client_id', id)
    .is('deleted_at', null)
    .single();

  if (!collection) return;

  // Get default collection server ID
  const { data: defaultCollection } = await supabase
    .from('user_collections')
    .select('id')
    .eq('client_id', DEFAULT_COLLECTION_ID)
    .is('deleted_at', null)
    .single();

  if (defaultCollection) {
    // Get all verse IDs in this collection via junction table
    const { data: verseLinks } = await supabase
      .from('verse_collections')
      .select('verse_id')
      .eq('collection_id', collection.id);

    if (verseLinks && verseLinks.length > 0) {
      // Move verses to default collection via junction table
      // Use upsert to handle verses that might already be in default collection
      const newLinks = verseLinks.map((link) => ({
        verse_id: link.verse_id,
        collection_id: defaultCollection.id,
        added_at: new Date().toISOString(),
      }));

      await supabase
        .from('verse_collections')
        .upsert(newLinks, { onConflict: 'verse_id,collection_id', ignoreDuplicates: true });
    }
  }

  // Delete junction entries for this collection (will be cleaned up by CASCADE anyway)
  await supabase
    .from('verse_collections')
    .delete()
    .eq('collection_id', collection.id);

  // Soft-delete the collection
  await supabase
    .from('user_collections')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', collection.id);
}

/**
 * Get verse count for a collection (via junction table)
 */
export async function getCollectionVerseCount(collectionId: string): Promise<number> {
  const { data: collection } = await supabase
    .from('user_collections')
    .select('id')
    .eq('client_id', collectionId)
    .is('deleted_at', null)
    .single();

  if (!collection) return 0;

  // Count via junction table, filtering out soft-deleted verses
  const { count, error } = await supabase
    .from('verse_collections')
    .select('user_verses!inner(id)', { count: 'exact', head: true })
    .eq('collection_id', collection.id)
    .is('user_verses.deleted_at', null);

  if (error) {
    console.error('[STORAGE] Failed to count verses:', error);
    return 0;
  }

  return count || 0;
}

// ============ VERSE FUNCTIONS ============

/**
 * Get all saved verses from Supabase (via junction table)
 */
export async function getSavedVerses(): Promise<SavedVerse[]> {
  try {
    const { data, error } = await supabase
      .from('verse_collections')
      .select(`
        added_at,
        user_collections!inner(client_id),
        user_verses!inner(*)
      `)
      .is('user_verses.deleted_at', null)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[STORAGE] Failed to fetch verses:', error);
      return [];
    }

    return data.map((vc: any) => ({
      id: vc.user_verses.client_id,
      collectionId: vc.user_collections.client_id,
      book: vc.user_verses.book,
      chapter: vc.user_verses.chapter,
      verseStart: vc.user_verses.verse_start,
      verseEnd: vc.user_verses.verse_end,
      version: vc.user_verses.version as BibleVersion,
      createdAt: new Date(vc.added_at).getTime(),
      progress: parseProgress(vc.user_verses.progress),
    }));
  } catch (e) {
    console.error('[STORAGE] Verse fetch error:', e);
    return [];
  }
}

/**
 * Get verses for a specific collection (via junction table)
 */
export async function getVersesByCollection(collectionId: string): Promise<SavedVerse[]> {
  try {
    const { data: collection } = await supabase
      .from('user_collections')
      .select('id')
      .eq('client_id', collectionId)
      .is('deleted_at', null)
      .single();

    if (!collection) return [];

    const { data, error } = await supabase
      .from('verse_collections')
      .select(`
        added_at,
        user_verses!inner(*)
      `)
      .eq('collection_id', collection.id)
      .is('user_verses.deleted_at', null)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[STORAGE] Failed to fetch verses:', error);
      return [];
    }

    return data.map((vc: any) => ({
      id: vc.user_verses.client_id,
      collectionId: collectionId,
      book: vc.user_verses.book,
      chapter: vc.user_verses.chapter,
      verseStart: vc.user_verses.verse_start,
      verseEnd: vc.user_verses.verse_end,
      version: vc.user_verses.version as BibleVersion,
      createdAt: new Date(vc.added_at).getTime(),
      progress: parseProgress(vc.user_verses.progress),
    }));
  } catch (e) {
    console.error('[STORAGE] Verse fetch error:', e);
    return [];
  }
}

/**
 * Save a verse to Supabase (via junction table)
 * - If verse exists (including soft-deleted): restore and add to collection
 * - If new: create verse and add to collection
 */
export async function saveVerse(
  verse: Omit<SavedVerse, 'id' | 'createdAt' | 'progress' | 'collectionId' | 'version'>,
  collectionId: string = DEFAULT_COLLECTION_ID,
  version: BibleVersion = 'ESV'
): Promise<SavedVerse> {
  const userId = await getCurrentUserId();
  const createdAt = new Date();

  // Get server collection ID
  let serverCollectionId: string;
  const { data: collection } = await supabase
    .from('user_collections')
    .select('id')
    .eq('client_id', collectionId)
    .is('deleted_at', null)
    .single();

  if (collection) {
    serverCollectionId = collection.id;
  } else {
    // Ensure default collection exists
    const { data: defaultColl, error: defaultError } = await supabase
      .from('user_collections')
      .select('id')
      .eq('client_id', DEFAULT_COLLECTION_ID)
      .is('deleted_at', null)
      .single();

    if (defaultColl) {
      serverCollectionId = defaultColl.id;
    } else {
      // Create default collection
      const { data: newDefault, error: createError } = await supabase
        .from('user_collections')
        .insert({
          user_id: userId,
          client_id: DEFAULT_COLLECTION_ID,
          name: 'My Verses',
          is_default: true,
          created_at: new Date(0).toISOString(),
        })
        .select('id')
        .single();

      if (createError || !newDefault) {
        throw new Error('Failed to create default collection');
      }
      serverCollectionId = newDefault.id;
    }
  }

  // Check if verse already exists (including soft-deleted)
  const { data: existing } = await supabase
    .from('user_verses')
    .select('id, client_id, deleted_at, progress')
    .eq('user_id', userId)
    .eq('book', verse.book)
    .eq('chapter', verse.chapter)
    .eq('verse_start', verse.verseStart)
    .eq('verse_end', verse.verseEnd)
    .eq('version', version)
    .maybeSingle();

  let clientId: string;
  let progress: VerseProgress = DEFAULT_PROGRESS;

  if (existing) {
    clientId = existing.client_id;
    progress = parseProgress(existing.progress);

    // Restore if soft-deleted
    if (existing.deleted_at) {
      await supabase
        .from('user_verses')
        .update({ deleted_at: null })
        .eq('id', existing.id);
    }

    // Add to collection via junction table (ignore if already exists)
    await supabase
      .from('verse_collections')
      .upsert(
        { verse_id: existing.id, collection_id: serverCollectionId, added_at: createdAt.toISOString() },
        { onConflict: 'verse_id,collection_id', ignoreDuplicates: true }
      );
  } else {
    // Create new verse
    clientId = `${verse.book}-${verse.chapter}-${verse.verseStart}-${verse.verseEnd}-${Date.now()}`;

    const { data: newVerse, error: insertError } = await supabase
      .from('user_verses')
      .insert({
        user_id: userId,
        client_id: clientId,
        book: verse.book,
        chapter: verse.chapter,
        verse_start: verse.verseStart,
        verse_end: verse.verseEnd,
        version,
        progress: DEFAULT_PROGRESS,
        created_at: createdAt.toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !newVerse) {
      console.error('[STORAGE] Failed to save verse:', insertError);
      throw new Error('Failed to save verse');
    }

    // Add to collection via junction table
    await supabase
      .from('verse_collections')
      .insert({ verse_id: newVerse.id, collection_id: serverCollectionId, added_at: createdAt.toISOString() });
  }

  return {
    id: clientId,
    collectionId,
    book: verse.book,
    chapter: verse.chapter,
    verseStart: verse.verseStart,
    verseEnd: verse.verseEnd,
    version,
    createdAt: createdAt.getTime(),
    progress,
  };
}

/**
 * Delete a verse from a collection
 * - Removes from junction table
 * - If no collections left: soft delete if mastered, hard delete otherwise
 *
 * @returns whether verse was mastered (for UI to show appropriate message)
 */
export async function deleteVerse(id: string, collectionId: string): Promise<{ wasMastered: boolean }> {
  // First check if verse is mastered
  const { data: verse } = await supabase
    .from('user_verses')
    .select('id, progress')
    .eq('client_id', id)
    .single();

  if (!verse) {
    console.error('[STORAGE] Verse not found:', id);
    return { wasMastered: false };
  }

  const isMastered = verse?.progress?.hard?.completed === true;

  // Get collection server ID
  const { data: collection } = await supabase
    .from('user_collections')
    .select('id')
    .eq('client_id', collectionId)
    .single();

  if (!collection) {
    console.error('[STORAGE] Collection not found:', collectionId);
    return { wasMastered: isMastered };
  }

  // Remove from junction table
  const { error: junctionError } = await supabase
    .from('verse_collections')
    .delete()
    .eq('verse_id', verse.id)
    .eq('collection_id', collection.id);

  if (junctionError) {
    console.error('[STORAGE] Failed to remove verse from collection:', junctionError);
    return { wasMastered: isMastered };
  }

  // Check if verse is still in any other collections
  const { count } = await supabase
    .from('verse_collections')
    .select('*', { count: 'exact', head: true })
    .eq('verse_id', verse.id);

  if (count === 0) {
    // No collections left
    if (isMastered) {
      // Soft delete - keep for Mastered list
      const { error } = await supabase
        .from('user_verses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', verse.id);

      if (error) {
        console.error('[STORAGE] Failed to soft delete verse:', error);
      }
    } else {
      // Hard delete - remove completely
      const { error } = await supabase
        .from('user_verses')
        .delete()
        .eq('id', verse.id);

      if (error) {
        console.error('[STORAGE] Failed to hard delete verse:', error);
      }
    }
  }

  return { wasMastered: isMastered };
}

/**
 * Update verse progress
 */
export async function updateVerseProgress(
  id: string,
  difficulty: Difficulty,
  accuracy: number
): Promise<void> {
  // Get current progress
  const { data: verse, error: fetchError } = await supabase
    .from('user_verses')
    .select('progress')
    .eq('client_id', id)
    .single();

  if (fetchError || !verse) {
    console.error('[STORAGE] Failed to fetch verse progress:', fetchError);
    return;
  }

  const currentProgress = parseProgress(verse.progress);
  const currentBest = currentProgress[difficulty]?.bestAccuracy;

  // Only update if this is a new best score
  if (currentBest === null || accuracy > currentBest) {
    const newProgress = {
      ...currentProgress,
      [difficulty]: {
        bestAccuracy: accuracy,
        completed: accuracy >= 90,
      },
    };

    const { error: updateError } = await supabase
      .from('user_verses')
      .update({ progress: newProgress })
      .eq('client_id', id);

    if (updateError) {
      console.error('[STORAGE] Failed to update progress:', updateError);
    }
  }
}

// ============ MASTERED VERSES ============

/**
 * Get all mastered verses (hard mode completed)
 * Includes soft-deleted verses - mastery is permanent
 */
export async function getMasteredVerses(): Promise<SavedVerse[]> {
  try {
    const { data, error } = await supabase
      .from('user_verses')
      .select('*')
      .eq('progress->hard->completed', true)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[STORAGE] Failed to get mastered verses:', error);
      return [];
    }

    return data.map((v) => ({
      id: v.client_id,
      collectionId: 'mastered', // Virtual collection
      book: v.book,
      chapter: v.chapter,
      verseStart: v.verse_start,
      verseEnd: v.verse_end,
      version: v.version as BibleVersion,
      createdAt: new Date(v.created_at).getTime(),
      progress: parseProgress(v.progress),
    }));
  } catch (e) {
    console.error('[STORAGE] Mastered verses fetch error:', e);
    return [];
  }
}

/**
 * Get count of mastered verses
 */
export async function getMasteredVerseCount(): Promise<number> {
  const { count, error } = await supabase
    .from('user_verses')
    .select('*', { count: 'exact', head: true })
    .eq('progress->hard->completed', true);

  if (error) {
    console.error('[STORAGE] Failed to count mastered verses:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Reset verse progress to initial state
 * Clears all difficulty scores and removes from Mastered list
 */
export async function resetVerseProgress(id: string): Promise<void> {
  const { error } = await supabase
    .from('user_verses')
    .update({ progress: DEFAULT_PROGRESS })
    .eq('client_id', id);

  if (error) {
    console.error('[STORAGE] Failed to reset verse progress:', error);
    throw new Error('Failed to reset progress');
  }
}

// ============ UTILITY FUNCTIONS ============

export function formatVerseReference(verse: SavedVerse): string {
  if (verse.verseStart === verse.verseEnd) {
    return `${verse.book} ${verse.chapter}:${verse.verseStart}`;
  }
  return `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`;
}
