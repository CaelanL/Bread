/**
 * Zustand Store for User Data
 *
 * Centralized state management for collections and verses.
 * Data is fetched from Supabase and cached in memory.
 * Components subscribe and auto-update when data changes.
 */

import { ensureAuth } from '@/lib/api';
import { getVerseText } from '@/lib/api/bible';
import { supabase } from '@/lib/api/client';
import type { ColorMode } from '@/lib/settings';
import type { BibleVersion, Collection, Difficulty, SavedVerse, SortOption, VerseProgress } from '@/lib/storage';
import { DEFAULT_PROGRESS, DEFAULT_SORT, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID, parseProgress, parseSortPreference, updateCollectionSort } from '@/lib/storage';
import { showErrorToast } from '@/lib/toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  getInProgressSort,
  getMasteredSort,
  setInProgressSort as persistInProgressSort,
  setMasteredSort as persistMasteredSort,
} from './library-sort';
import { computeNextSrState } from './review';
import { DEFAULT_MAX_INTERVAL_DAYS, MAX_USER_MAX_INTERVAL_DAYS, MIN_USER_MAX_INTERVAL_DAYS } from './review-config';

const COLOR_MODE_KEY = 'app_color_mode';
const BIBLE_VERSION_KEY = 'app_bible_version';
const REVIEW_MAX_INTERVAL_DAYS_KEY = 'review_max_interval_days';

// ============ CONSTANTS ============

const DEFAULT_COLLECTION_ID = 'my-verses';

const DEFAULT_COLLECTION: Collection = {
  id: DEFAULT_COLLECTION_ID,
  name: 'My Verses',
  isDefault: true,
  createdAt: 0,
};

const MASTERED_COLLECTION: Collection = {
  id: MASTERED_COLLECTION_ID,
  name: 'Mastered',
  isDefault: false,
  isVirtual: true,
  icon: 'checkmark.circle.fill',
  iconColor: '#22c55e',
  createdAt: 0,
};

const IN_PROGRESS_COLLECTION: Collection = {
  id: IN_PROGRESS_COLLECTION_ID,
  name: 'In Progress',
  isDefault: false,
  isVirtual: true,
  icon: 'hourglass',
  iconColor: '#f59e0b',
  createdAt: 0,
};

// ============ STORE INTERFACE ============

interface AppState {
  // Data
  collections: Collection[];
  verses: SavedVerse[];
  masteredVerses: SavedVerse[];

  // Settings
  colorMode: ColorMode;
  bibleVersion: BibleVersion;
  reviewMaxIntervalDays: number;

  // Sort preferences for virtual collections (device-local; mirrored to AsyncStorage)
  masteredSort: SortOption;
  inProgressSort: SortOption;

  // Loading states
  hydrated: boolean;
  collectionsLoading: boolean;
  versesLoading: boolean;
  masteredLoading: boolean;

  // Error state
  error: string | null;

  // Actions - Fetch
  fetchCollections: () => Promise<boolean>;
  fetchVerses: () => Promise<boolean>;
  fetchMasteredVerses: () => Promise<boolean>;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;

  // Actions - Settings
  setColorMode: (mode: ColorMode) => Promise<void>;
  setBibleVersion: (version: BibleVersion) => Promise<void>;
  setReviewMaxIntervalDays: (days: number) => Promise<void>;

  // Actions - Collections
  addCollection: (name: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;
  setCollectionSort: (collectionId: string, sort: SortOption) => Promise<void>;

  // Actions - Verses
  addVerse: (
    verse: Omit<SavedVerse, 'id' | 'createdAt' | 'progress' | 'collectionId' | 'version'>,
    collectionId: string,
    version: BibleVersion
  ) => Promise<SavedVerse>;
  deleteVerse: (id: string, collectionId: string) => Promise<{ wasMastered: boolean }>;
  updateVerseProgress: (
    id: string,
    difficulty: Difficulty,
    accuracy: number,
    fullSession?: boolean,
  ) => Promise<void>;
  resetVerseProgress: (id: string) => Promise<void>;

  // Reset
  clear: () => void;
}

// ============ HELPERS ============

async function getCurrentUserId(): Promise<string> {
  await ensureAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ============ STORE ============

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  collections: [],
  verses: [],
  masteredVerses: [],
  colorMode: 'system',
  bibleVersion: 'ESV',
  reviewMaxIntervalDays: DEFAULT_MAX_INTERVAL_DAYS,
  // Mastered defaults to due-first (review-aware default). Overwritten
  // by hydrate() if AsyncStorage has a saved value. In Progress and
  // user collections default to 'recent'.
  masteredSort: 'due-first',
  inProgressSort: DEFAULT_SORT,
  hydrated: false,
  collectionsLoading: true,
  versesLoading: true,
  masteredLoading: true,
  error: null,

  // ============ FETCH ACTIONS ============

  fetchCollections: async () => {
    set({ collectionsLoading: true });
    try {
      const { data, error } = await supabase
        .from('user_collections')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[STORE] Failed to fetch collections:', error);
        // Keep existing state, set error
        set({ collectionsLoading: false, error: 'Failed to load collections' });
        return false;
      }

      const collections: Collection[] = data.map((c) => ({
        id: c.client_id,
        name: c.name,
        isDefault: c.is_default,
        createdAt: new Date(c.created_at).getTime(),
        sortPreference: parseSortPreference(c.sort_preference),
      }));

      // Ensure default collection always exists
      const hasDefault = collections.some((c) => c.isDefault);
      if (!hasDefault) {
        collections.unshift(DEFAULT_COLLECTION);
      }

      // Add Mastered + In Progress virtual collections after default
      const defaultIndex = collections.findIndex((c) => c.isDefault);
      collections.splice(defaultIndex + 1, 0, MASTERED_COLLECTION, IN_PROGRESS_COLLECTION);

      set({ collections, collectionsLoading: false, error: null });
      return true;
    } catch (e) {
      console.error('[STORE] Collection fetch error:', e);
      // Keep existing state, set error
      set({ collectionsLoading: false, error: 'Failed to load collections' });
      return false;
    }
  },

  fetchVerses: async () => {
    set({ versesLoading: true });
    try {
      // Query via junction table - returns verse for each collection it's in
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
        console.error('[STORE] Failed to fetch verses:', error);
        // Keep existing state, set error
        set({ versesLoading: false, error: 'Failed to load verses' });
        return false;
      }

      // Map junction rows to SavedVerse (one entry per collection membership)
      const verses: SavedVerse[] = data.map((vc: any) => ({
        id: vc.user_verses.client_id,
        collectionId: vc.user_collections.client_id,
        book: vc.user_verses.book,
        chapter: vc.user_verses.chapter,
        verseStart: vc.user_verses.verse_start,
        verseEnd: vc.user_verses.verse_end,
        version: vc.user_verses.version as BibleVersion,
        createdAt: new Date(vc.added_at).getTime(),
        progress: parseProgress(vc.user_verses.progress),
        lastPracticedAt: typeof vc.user_verses.last_practiced_at === 'string'
          ? vc.user_verses.last_practiced_at
          : undefined,
      }));

      set({ verses, versesLoading: false, error: null });
      return true;
    } catch (e) {
      console.error('[STORE] Verse fetch error:', e);
      // Keep existing state, set error
      set({ versesLoading: false, error: 'Failed to load verses' });
      return false;
    }
  },

  fetchMasteredVerses: async () => {
    set({ masteredLoading: true });
    try {
      // Fetch mastered verses directly from DB - NO deleted_at filter
      // This includes soft-deleted verses so they stay in Mastered list
      const { data, error } = await supabase
        .from('user_verses')
        .select('*')
        .eq('progress->hard->completed', true)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[STORE] Failed to fetch mastered verses:', error);
        set({ masteredLoading: false });
        return false;
      }

      const masteredVerses: SavedVerse[] = data.map((v) => ({
        id: v.client_id,
        collectionId: MASTERED_COLLECTION_ID,
        book: v.book,
        chapter: v.chapter,
        verseStart: v.verse_start,
        verseEnd: v.verse_end,
        version: v.version as BibleVersion,
        createdAt: new Date(v.created_at).getTime(),
        progress: parseProgress(v.progress),
        lastPracticedAt: typeof v.last_practiced_at === 'string'
          ? v.last_practiced_at
          : undefined,
      }));

      set({ masteredVerses, masteredLoading: false });
      return true;
    } catch (e) {
      console.error('[STORE] Mastered verses fetch error:', e);
      set({ masteredLoading: false });
      return false;
    }
  },

  hydrate: async () => {
    // Load settings from AsyncStorage (doesn't require auth)
    try {
      const [savedColorMode, savedBibleVersion, savedReviewMax, savedMasteredSort, savedInProgressSort] = await Promise.all([
        AsyncStorage.getItem(COLOR_MODE_KEY),
        AsyncStorage.getItem(BIBLE_VERSION_KEY),
        AsyncStorage.getItem(REVIEW_MAX_INTERVAL_DAYS_KEY),
        getMasteredSort(),
        getInProgressSort(),
      ]);

      const updates: Partial<AppState> = {};
      if (savedColorMode && ['light', 'dark', 'system'].includes(savedColorMode)) {
        updates.colorMode = savedColorMode as ColorMode;
      }
      if (savedBibleVersion && ['ESV', 'NLT', 'NIV', 'NKJV', 'KJV'].includes(savedBibleVersion)) {
        updates.bibleVersion = savedBibleVersion as BibleVersion;
      }
      if (savedReviewMax) {
        const parsed = parseInt(savedReviewMax, 10);
        if (Number.isFinite(parsed) && parsed >= MIN_USER_MAX_INTERVAL_DAYS && parsed <= MAX_USER_MAX_INTERVAL_DAYS) {
          updates.reviewMaxIntervalDays = parsed;
        }
      }
      if (savedMasteredSort) {
        updates.masteredSort = savedMasteredSort;
      }
      if (savedInProgressSort) {
        updates.inProgressSort = savedInProgressSort;
      }
      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (e) {
      console.error('[STORE] Failed to load settings:', e);
    }

    let [collectionsOk, versesOk, masteredOk] = await Promise.all([
      get().fetchCollections(),
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);

    // Retry once after short delay if any fetch failed (handles auth propagation race)
    if (!collectionsOk || !versesOk || !masteredOk) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      [collectionsOk, versesOk, masteredOk] = await Promise.all([
        collectionsOk ? true : get().fetchCollections(),
        versesOk ? true : get().fetchVerses(),
        masteredOk ? true : get().fetchMasteredVerses(),
      ]);
    }

    // Always mark as hydrated so UI can render (partial data is better than nothing)
    set({ hydrated: true });

    // Show toast only if retry also failed
    if (!collectionsOk || !versesOk || !masteredOk) {
      showErrorToast('Some data failed to load. Pull to refresh.');
    } else {
      set({ error: null });

      // Prefetch verse text in background (non-blocking)
      // This populates the session cache so cards render instantly
      const verses = get().verses;
      if (verses.length > 0) {
        Promise.all(verses.map((v) => getVerseText(v).catch(() => ({ text: '', verses: {} }))));
      }
    }
  },

  refresh: async () => {
    set({ error: null });
    await Promise.all([
      get().fetchCollections(),
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);
  },

  clearError: () => {
    set({ error: null });
  },

  // ============ SETTINGS ACTIONS ============

  setColorMode: async (mode: ColorMode) => {
    set({ colorMode: mode });
    try {
      await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
    } catch (e) {
      console.error('[STORE] Failed to save colorMode:', e);
    }
  },

  setBibleVersion: async (version: BibleVersion) => {
    set({ bibleVersion: version });
    try {
      await AsyncStorage.setItem(BIBLE_VERSION_KEY, version);
    } catch (e) {
      console.error('[STORE] Failed to save bibleVersion:', e);
    }
  },

  setReviewMaxIntervalDays: async (days: number) => {
    const clamped = Math.min(
      MAX_USER_MAX_INTERVAL_DAYS,
      Math.max(MIN_USER_MAX_INTERVAL_DAYS, Math.round(days)),
    );
    set({ reviewMaxIntervalDays: clamped });
    try {
      await AsyncStorage.setItem(REVIEW_MAX_INTERVAL_DAYS_KEY, String(clamped));
    } catch (e) {
      console.error('[STORE] Failed to save reviewMaxIntervalDays:', e);
    }
  },

  // ============ COLLECTION ACTIONS ============

  addCollection: async (name: string) => {
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
      console.error('[STORE] Failed to create collection:', error);
      throw new Error('Failed to create collection');
    }

    const newCollection: Collection = {
      id: clientId,
      name,
      isDefault: false,
      createdAt: createdAt.getTime(),
    };

    // Optimistically add to store
    set((state) => ({
      collections: [...state.collections, newCollection],
    }));

    return newCollection;
  },

  deleteCollection: async (id: string) => {
    if (id === DEFAULT_COLLECTION_ID) return;

    // Get server UUID for this collection
    const { data: collection, error: collectionError } = await supabase
      .from('user_collections')
      .select('id')
      .eq('client_id', id)
      .is('deleted_at', null)
      .single();

    if (collectionError || !collection) {
      console.error('[STORE] Collection not found for deletion:', id);
      throw new Error('Collection not found');
    }

    // Get all verses in this collection with their details
    const { data: verseLinks } = await supabase
      .from('verse_collections')
      .select(`
        verse_id,
        user_verses!inner (
          id,
          client_id,
          progress
        )
      `)
      .eq('collection_id', collection.id);

    // Process each verse
    for (const link of verseLinks || []) {
      const verse = link.user_verses as any;
      const verseServerId = verse.id;
      const isMastered = verse.progress?.hard?.completed === true;

      // Check if verse is in other collections
      const { count: otherCollectionCount } = await supabase
        .from('verse_collections')
        .select('*', { count: 'exact', head: true })
        .eq('verse_id', verseServerId)
        .neq('collection_id', collection.id);

      // Remove from this collection's junction
      await supabase
        .from('verse_collections')
        .delete()
        .eq('verse_id', verseServerId)
        .eq('collection_id', collection.id);

      // If verse is not in any other collection, handle deletion
      if ((otherCollectionCount || 0) === 0) {
        if (isMastered) {
          // Soft delete - keep for Mastered list
          await supabase
            .from('user_verses')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', verseServerId);
        } else {
          // Hard delete - remove completely
          await supabase
            .from('user_verses')
            .delete()
            .eq('id', verseServerId);
        }
      }
    }

    // Soft-delete the collection
    const { error: deleteError } = await supabase
      .from('user_collections')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', collection.id);

    if (deleteError) {
      console.error('[STORE] Failed to delete collection:', deleteError);
      throw new Error('Failed to delete collection');
    }

    // Update local state - remove collection and its verses
    const versesInCollection = get().verses.filter((v) => v.collectionId === id);
    const verseIdsToRemove = new Set(versesInCollection.map((v) => v.id));

    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      verses: state.verses.filter((v) => v.collectionId !== id),
      // Keep mastered verses in masteredVerses list (they're soft-deleted)
    }));
  },

  setCollectionSort: async (collectionId: string, sort: SortOption) => {
    // Route by ID literal — virtual collection objects in `collections`
    // never carry a sortPreference field.
    if (collectionId === MASTERED_COLLECTION_ID) {
      set({ masteredSort: sort });
      try {
        await persistMasteredSort(sort);
      } catch (e) {
        console.error('[STORE] Failed to persist mastered sort:', e);
      }
      return;
    }
    if (collectionId === IN_PROGRESS_COLLECTION_ID) {
      set({ inProgressSort: sort });
      try {
        await persistInProgressSort(sort);
      } catch (e) {
        console.error('[STORE] Failed to persist in-progress sort:', e);
      }
      return;
    }

    // Real user collection — optimistic Zustand update, then DB write.
    const previous = get().collections;
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === collectionId ? { ...c, sortPreference: sort } : c,
      ),
    }));
    try {
      await updateCollectionSort(collectionId, sort);
    } catch (e) {
      console.error('[STORE] Failed to persist collection sort:', e);
      set({ collections: previous });
      showErrorToast("Couldn't save sort preference.");
    }
  },

  // ============ VERSE ACTIONS ============

  addVerse: async (verse, collectionId, version) => {
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
      const { data: defaultColl } = await supabase
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

    let verseId: string;
    let clientId: string;
    let progress: SavedVerse['progress'] = DEFAULT_PROGRESS;

    if (existing) {
      verseId = existing.id;
      clientId = existing.client_id;
      progress = parseProgress(existing.progress);

      // Restore if soft-deleted
      if (existing.deleted_at) {
        const { error: restoreError } = await supabase
          .from('user_verses')
          .update({ deleted_at: null })
          .eq('id', existing.id);

        if (restoreError) {
          console.error('[STORE] Failed to restore verse:', restoreError);
          throw new Error('Failed to restore verse');
        }
      }

      // Add to collection via junction table (ignore if already exists)
      const { error: junctionError } = await supabase
        .from('verse_collections')
        .upsert(
          { verse_id: existing.id, collection_id: serverCollectionId, added_at: createdAt.toISOString() },
          { onConflict: 'verse_id,collection_id', ignoreDuplicates: true }
        );

      if (junctionError) {
        console.error('[STORE] Failed to add verse to collection:', junctionError);
        throw new Error('Failed to add verse to collection');
      }
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
        console.error('[STORE] Failed to save verse:', insertError);
        throw new Error('Failed to save verse');
      }

      verseId = newVerse.id;

      // Add to collection via junction table
      const { error: junctionError } = await supabase
        .from('verse_collections')
        .insert({ verse_id: newVerse.id, collection_id: serverCollectionId, added_at: createdAt.toISOString() });

      if (junctionError) {
        console.error('[STORE] Failed to add verse to collection:', junctionError);
        throw new Error('Failed to add verse to collection');
      }
    }

    const resultVerse: SavedVerse = {
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

    // Optimistic update - add to local state
    set((state) => ({
      verses: [resultVerse, ...state.verses],
    }));

    return resultVerse;
  },

  deleteVerse: async (id: string, collectionId: string): Promise<{ wasMastered: boolean }> => {
    // Get verse info
    const verse = get().verses.find((v) => v.id === id);
    const isMastered = verse?.progress?.hard?.completed === true;

    // Save for rollback
    const previousVerses = get().verses;

    // Optimistic update - remove from local state immediately
    set((state) => ({
      verses: state.verses.filter((v) => !(v.id === id && v.collectionId === collectionId)),
      // Don't remove from masteredVerses - mastery is permanent
    }));

    try {
      // Get server IDs for verse and collection
      const { data: verseData } = await supabase
        .from('user_verses')
        .select('id')
        .eq('client_id', id)
        .single();

      const { data: collectionData } = await supabase
        .from('user_collections')
        .select('id')
        .eq('client_id', collectionId)
        .single();

      if (!verseData || !collectionData) {
        console.error('[STORE] Verse or collection not found');
        throw new Error('Verse not found');
      }

      // Remove from junction table (remove from this collection)
      const { error: junctionError } = await supabase
        .from('verse_collections')
        .delete()
        .eq('verse_id', verseData.id)
        .eq('collection_id', collectionData.id);

      if (junctionError) {
        console.error('[STORE] Failed to remove verse from collection:', junctionError);
        throw new Error('Failed to delete verse');
      }

      // Check if verse is still in any other collections
      const { count } = await supabase
        .from('verse_collections')
        .select('*', { count: 'exact', head: true })
        .eq('verse_id', verseData.id);

      if (count === 0) {
        // No collections left - delete or soft-delete the verse itself
        if (isMastered) {
          // Soft delete - keep for Mastered list
          const { error } = await supabase
            .from('user_verses')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', verseData.id);

          if (error) {
            console.error('[STORE] Failed to soft delete verse:', error);
          }
        } else {
          // Hard delete - remove completely
          const { error } = await supabase
            .from('user_verses')
            .delete()
            .eq('id', verseData.id);

          if (error) {
            console.error('[STORE] Failed to hard delete verse:', error);
          }
        }
      }

      return { wasMastered: isMastered };
    } catch (error) {
      // Rollback on failure
      set({ verses: previousVerses });
      throw error;
    }
  },

  updateVerseProgress: async (id, difficulty, accuracy, fullSession = false) => {
    // Look up the verse in `state.verses` only — `masteredVerses` may
    // contain soft-deleted rows that aren't in `state.verses` and shouldn't
    // be progressing anyway (no active session can reach them today).
    //
    // Multi-device note: writes to Supabase are last-write-wins. Two
    // devices reviewing the same verse against their own stale local
    // `nextDueAt` can each treat the review as on-time and double-bump
    // passCount, OR clobber each other and lose an increment. Spec
    // accepts this as drift-by-1 for personal use (review-system.md
    // "Concurrent updates from two devices"). If realtime sync is added
    // later, reconcile passCount via lastReviewedAt comparison.
    // Look up across both arrays — a soft-deleted-but-mastered verse
    // is in `masteredVerses` only (not in `verses`), and the study setup
    // screen routes through useVerse() which checks both. Without this
    // fallback, practicing such a verse would silently no-op the
    // timestamp bump and the "Recent" sort wouldn't reflect the session.
    const verse =
      get().verses.find((v) => v.id === id) ??
      get().masteredVerses.find((v) => v.id === id);
    if (!verse) return;

    const currentBest = verse.progress[difficulty]?.bestAccuracy;
    const isNewBest = currentBest === null || accuracy > currentBest;
    const isQualifyingReview = difficulty === 'hard' && accuracy >= 90 && fullSession;
    const nowIso = new Date().toISOString();

    // Build the UPDATE shape. `last_practiced_at` always present so any
    // session completion (full or partial, new-best or not) floats this
    // verse to the top of the "Recent" sort. `progress` only included
    // when something actually changed.
    const updateShape: { last_practiced_at: string; progress?: VerseProgress } = {
      last_practiced_at: nowIso,
    };

    let newProgress: VerseProgress = verse.progress;
    let justBecameMastered = false;

    if (isNewBest || isQualifyingReview) {
      newProgress = { ...verse.progress };

      if (isNewBest) {
        newProgress[difficulty] = {
          bestAccuracy: accuracy,
          completed: accuracy >= 90,
        };
      }

      if (isQualifyingReview) {
        const prevEngraved = newProgress.engraved ?? DEFAULT_PROGRESS.engraved!;
        newProgress.engraved = computeNextSrState(
          prevEngraved,
          accuracy,
          difficulty,
          fullSession,
          new Date(),
          get().reviewMaxIntervalDays,
        );
      }

      updateShape.progress = newProgress;
      justBecameMastered = !!(newProgress.hard?.completed && !verse.progress.hard?.completed);
    }

    // Update on server
    const { error } = await supabase
      .from('user_verses')
      .update(updateShape)
      .eq('client_id', id);

    if (error) {
      console.error('[STORE] Failed to update progress:', error);
      throw new Error('Failed to save progress');
    }

    // Optimistic Zustand update mirrors both progress and timestamp on
    // every entry for this verse (junction-row shape: a verse in N
    // collections has N entries in `verses[]`, all sharing one client_id).
    set((state) => {
      const updatedVerses = state.verses.map((v) =>
        v.id === id ? { ...v, progress: newProgress, lastPracticedAt: nowIso } : v,
      );

      let updatedMastered = state.masteredVerses;
      if (justBecameMastered) {
        const masteredVerse: SavedVerse = {
          ...verse,
          progress: newProgress,
          lastPracticedAt: nowIso,
          collectionId: MASTERED_COLLECTION_ID,
        };
        updatedMastered = [masteredVerse, ...state.masteredVerses];
      } else {
        updatedMastered = state.masteredVerses.map((v) =>
          v.id === id ? { ...v, progress: newProgress, lastPracticedAt: nowIso } : v,
        );
      }

      return { verses: updatedVerses, masteredVerses: updatedMastered };
    });
  },

  resetVerseProgress: async (id: string) => {
    // Check if verse was mastered before reset
    const verse = get().verses.find((v) => v.id === id);
    const wasMastered = verse?.progress?.hard?.completed === true;

    // Save for rollback
    const previousVerses = get().verses;
    const previousMastered = get().masteredVerses;

    // Optimistic update — also clear lastPracticedAt so the reset verse
    // drops to the bottom of the "Recent" sort.
    set((state) => ({
      verses: state.verses.map((v) =>
        v.id === id ? { ...v, progress: DEFAULT_PROGRESS, lastPracticedAt: undefined } : v
      ),
      // Remove from mastered if it was mastered
      masteredVerses: wasMastered
        ? state.masteredVerses.filter((v) => v.id !== id)
        : state.masteredVerses,
    }));

    try {
      // Update on server
      const { error } = await supabase
        .from('user_verses')
        .update({ progress: DEFAULT_PROGRESS, last_practiced_at: null })
        .eq('client_id', id);

      if (error) {
        console.error('[STORE] Failed to reset progress:', error);
        throw new Error('Failed to reset progress');
      }
    } catch (error) {
      // Rollback on failure
      set({ verses: previousVerses, masteredVerses: previousMastered });
      throw error;
    }
  },

  // ============ RESET ============

  clear: () => {
    set({
      collections: [],
      verses: [],
      masteredVerses: [],
      // Device prefs (colorMode, bibleVersion, reviewMaxIntervalDays,
      // masteredSort, inProgressSort) are preserved across sign-out by
      // virtue of being absent from this set call — Zustand keeps
      // unspecified keys. AsyncStorage copies are never touched here.
      hydrated: false,
      collectionsLoading: true,
      versesLoading: true,
      masteredLoading: true,
      error: null,
    });
  },
}));

// ============ SELECTORS ============

import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

export const useCollections = () => useAppStore((state) => state.collections);
export const useVerses = () => useAppStore((state) => state.verses);
export const useHydrated = () => useAppStore((state) => state.hydrated);
export const useStoreError = () => useAppStore((state) => state.error);
export const useReviewMaxIntervalDays = () => useAppStore((state) => state.reviewMaxIntervalDays);

/**
 * Sort preference for a given collection. Routes by ID literal because
 * virtual-collection objects in `collections` never carry a
 * `sortPreference` field — the splice in fetchCollections inserts the
 * frozen MASTERED_COLLECTION / IN_PROGRESS_COLLECTION constants.
 */
export function useCollectionSort(collectionId: string): SortOption {
  return useAppStore((state) => {
    if (collectionId === MASTERED_COLLECTION_ID) return state.masteredSort;
    if (collectionId === IN_PROGRESS_COLLECTION_ID) return state.inProgressSort;
    const collection = state.collections.find((c) => c.id === collectionId);
    return collection?.sortPreference ?? DEFAULT_SORT;
  });
}

export function useVersesByCollection(collectionId: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(
    () => verses.filter((v) => v.collectionId === collectionId),
    [verses, collectionId]
  );
}

export function useCollectionVerseCount(collectionId: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(
    () => verses.filter((v) => v.collectionId === collectionId).length,
    [verses, collectionId]
  );
}

export function useVerse(id: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  const masteredVerses = useAppStore(useShallow((state) => state.masteredVerses));
  return useMemo(
    () => verses.find((v) => v.id === id) || masteredVerses.find((v) => v.id === id),
    [verses, masteredVerses, id]
  );
}

export function useCollection(id: string) {
  const collections = useAppStore(useShallow((state) => state.collections));
  return useMemo(
    () => collections.find((c) => c.id === id),
    [collections, id]
  );
}

/**
 * Get all mastered verses (hard mode completed with ≥90% accuracy)
 * Includes soft-deleted verses - mastery is permanent
 */
export function useMasteredVerses() {
  return useAppStore((state) => state.masteredVerses);
}

export function useMasteredVerseCount() {
  return useAppStore((state) => state.masteredVerses.length);
}

/**
 * Internal: predicate matching the In Progress definition. Lenient — any
 * non-null bestAccuracy on any difficulty AND not yet mastered on Hard.
 * Used by both the In Progress virtual collection and the Insights count
 * so the two can never drift.
 *
 * SQL parity: the in-progress notification source mirrors this predicate
 * server-side at supabase/functions/send-notifications/sources/in-progress.ts
 * (`loadInProgressVerses`). If you change this predicate, change there too —
 * otherwise users will get nudged about verses the in-app collection
 * doesn't show, or vice versa.
 */
function isInProgressVerse(v: SavedVerse): boolean {
  if (v.progress.hard?.completed) return false;
  const p = v.progress;
  return (
    p.easy?.bestAccuracy !== null ||
    p.medium?.bestAccuracy !== null ||
    p.hard?.bestAccuracy !== null
  );
}

/**
 * Get unique In Progress verses (any progress on any difficulty, not yet
 * mastered on Hard). Deduped by verse id.
 */
export function useInProgressVerses() {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(() => {
    const seen = new Set<string>();
    const result: SavedVerse[] = [];
    for (const v of verses) {
      if (seen.has(v.id)) continue;
      if (!isInProgressVerse(v)) continue;
      seen.add(v.id);
      result.push(v);
    }
    return result;
  }, [verses]);
}

export function useInProgressVerseCount() {
  const inProgress = useInProgressVerses();
  return inProgress.length;
}

/**
 * Per-verse review state. 'pre-mastery' for unmastered verses; 'due',
 * 'locked', or 'engraved' for mastered ones.
 *
 * Precedence: engraved > due > locked > pre-mastery. Engraved verses that
 * are also due render as Engraved (the lifetime count carries the visual
 * weight); their due-ness is communicated via sort order, not the badge.
 */
export type ReviewState = 'pre-mastery' | 'locked' | 'due' | 'engraved';

export function useReviewState(verseId: string, now?: Date): ReviewState {
  const verse = useVerse(verseId);
  const nowMs = now ? now.getTime() : Date.now();
  return useMemo<ReviewState>(() => {
    if (!verse) return 'pre-mastery';
    const e = verse.progress.engraved;
    if (!verse.progress.hard?.completed) return 'pre-mastery';
    if (e?.completed) return 'engraved';
    if (!e || e.nextDueAt === null) return 'due';
    return nowMs >= new Date(e.nextDueAt).getTime() ? 'due' : 'locked';
  }, [verse, nowMs]);
}

/**
 * Counts of due verses by virtual collection. Only Mastered has an SR
 * schedule; In Progress verses are pre-mastery and cannot be "due".
 *
 * Pass a live-ticking `now` (e.g. from `useReviewNow`) to keep the count
 * fresh as verses transition from Locked → Due without a manual refresh.
 */
export function useDueCounts(now?: Date) {
  const masteredVerses = useAppStore(useShallow((state) => state.masteredVerses));
  const nowMs = now ? now.getTime() : Date.now();
  return useMemo(() => {
    let mastered = 0;
    const seen = new Set<string>();
    for (const v of masteredVerses) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const e = v.progress.engraved;
      if (!v.progress.hard?.completed) continue;
      if (!e || e.nextDueAt === null) {
        mastered += 1;
        continue;
      }
      if (nowMs >= new Date(e.nextDueAt).getTime()) mastered += 1;
    }
    return { mastered };
  }, [masteredVerses, nowMs]);
}

/**
 * Get insights stats: mastered count and in-progress count.
 *
 * In Progress count is sourced from the same `isInProgressVerse` predicate
 * as `useInProgressVerses`, so the Library In Progress collection count
 * and the Insights "Verses in progress" count are guaranteed equal.
 */
export function useInsightsStats() {
  const verses = useAppStore(useShallow((state) => state.verses));
  const masteredVerses = useAppStore(useShallow((state) => state.masteredVerses));

  return useMemo(() => {
    const versesMastered = masteredVerses.length;
    const seen = new Set<string>();
    for (const v of verses) {
      if (seen.has(v.id)) continue;
      if (!isInProgressVerse(v)) continue;
      seen.add(v.id);
    }
    return {
      versesMastered,
      inProgress: seen.size,
    };
  }, [verses, masteredVerses]);
}

/**
 * Get most memorized books (books with most mastered verses)
 */
export function useMostMemorizedBooks() {
  const masteredVerses = useAppStore(useShallow((state) => state.masteredVerses));

  return useMemo(() => {
    const bookCounts: Record<string, number> = {};

    // Count mastered verses per book (deduplicate by ID first)
    const seenIds = new Set<string>();
    masteredVerses.forEach((v) => {
      if (seenIds.has(v.id)) return;
      seenIds.add(v.id);
      bookCounts[v.book] = (bookCounts[v.book] || 0) + 1;
    });

    return Object.entries(bookCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [masteredVerses]);
}
