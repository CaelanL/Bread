/**
 * Zustand Store for User Data
 *
 * Centralized state management for collections and verses.
 * Data is fetched from Supabase and cached in memory.
 * Components subscribe and auto-update when data changes.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/api/client';
import { ensureAuth } from '@/lib/api';
import type { Collection, SavedVerse, BibleVersion, Difficulty } from '@/lib/storage';
import { MASTERED_COLLECTION_ID } from '@/lib/storage';
import type { ColorMode } from '@/lib/settings';

const COLOR_MODE_KEY = 'app_color_mode';
const BIBLE_VERSION_KEY = 'app_bible_version';

// ============ CONSTANTS ============

const DEFAULT_COLLECTION_ID = 'my-verses';

const DEFAULT_PROGRESS = {
  easy: { bestAccuracy: null, completed: false },
  medium: { bestAccuracy: null, completed: false },
  hard: { bestAccuracy: null, completed: false },
};

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

// ============ STORE INTERFACE ============

interface AppState {
  // Data
  collections: Collection[];
  verses: SavedVerse[];
  masteredVerses: SavedVerse[];

  // Settings
  colorMode: ColorMode;
  bibleVersion: BibleVersion;

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

  // Actions - Collections
  addCollection: (name: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;

  // Actions - Verses
  addVerse: (
    verse: Omit<SavedVerse, 'id' | 'createdAt' | 'progress' | 'collectionId' | 'version'>,
    collectionId: string,
    version: BibleVersion
  ) => Promise<SavedVerse>;
  deleteVerse: (id: string, collectionId: string) => Promise<{ wasMastered: boolean }>;
  updateVerseProgress: (id: string, difficulty: Difficulty, accuracy: number) => Promise<void>;
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

      // Add Mastered collection after default (always second)
      const defaultIndex = collections.findIndex((c) => c.isDefault);
      collections.splice(defaultIndex + 1, 0, MASTERED_COLLECTION);

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
      const verses = data.map((vc: any) => ({
        id: vc.user_verses.client_id,
        collectionId: vc.user_collections.client_id,
        book: vc.user_verses.book,
        chapter: vc.user_verses.chapter,
        verseStart: vc.user_verses.verse_start,
        verseEnd: vc.user_verses.verse_end,
        version: vc.user_verses.version as BibleVersion,
        createdAt: new Date(vc.added_at).getTime(),
        progress: vc.user_verses.progress || DEFAULT_PROGRESS,
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

      const masteredVerses = data.map((v) => ({
        id: v.client_id,
        collectionId: MASTERED_COLLECTION_ID,
        book: v.book,
        chapter: v.chapter,
        verseStart: v.verse_start,
        verseEnd: v.verse_end,
        version: v.version as BibleVersion,
        createdAt: new Date(v.created_at).getTime(),
        progress: v.progress || DEFAULT_PROGRESS,
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
    console.log('[STORE] Hydrating...');

    // Load settings from AsyncStorage (doesn't require auth)
    try {
      const [savedColorMode, savedBibleVersion] = await Promise.all([
        AsyncStorage.getItem(COLOR_MODE_KEY),
        AsyncStorage.getItem(BIBLE_VERSION_KEY),
      ]);

      const updates: Partial<AppState> = {};
      if (savedColorMode && ['light', 'dark', 'system'].includes(savedColorMode)) {
        updates.colorMode = savedColorMode as ColorMode;
      }
      if (savedBibleVersion && ['ESV', 'NLT'].includes(savedBibleVersion)) {
        updates.bibleVersion = savedBibleVersion as BibleVersion;
      }
      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (e) {
      console.error('[STORE] Failed to load settings:', e);
    }

    const [collectionsOk, versesOk, masteredOk] = await Promise.all([
      get().fetchCollections(),
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);
    // Only mark as hydrated if all fetches succeeded
    if (collectionsOk && versesOk && masteredOk) {
      set({ hydrated: true, error: null });
      console.log('[STORE] Hydrated successfully');
    } else {
      console.log('[STORE] Hydration failed - data may be stale');
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

    // Get default collection server ID FIRST (before deleting)
    const { data: defaultCollection, error: defaultError } = await supabase
      .from('user_collections')
      .select('id')
      .eq('client_id', DEFAULT_COLLECTION_ID)
      .is('deleted_at', null)
      .single();

    if (defaultError || !defaultCollection) {
      console.error('[STORE] Default collection not found, cannot reassign verses');
      throw new Error('Cannot delete collection: default collection not found');
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

    // Move verses to default collection on server
    const { error: moveError } = await supabase
      .from('user_verses')
      .update({ collection_id: defaultCollection.id })
      .eq('collection_id', collection.id)
      .is('deleted_at', null);

    if (moveError) {
      console.error('[STORE] Failed to move verses to default collection:', moveError);
      // Collection is already deleted, but verses weren't moved - this is a problem
      // Refresh to get correct server state
      get().refresh();
      throw new Error('Collection deleted but failed to move verses');
    }

    // Update local state
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      verses: state.verses.map((v) =>
        v.collectionId === id ? { ...v, collectionId: DEFAULT_COLLECTION_ID } : v
      ),
    }));
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
    let progress = DEFAULT_PROGRESS;

    if (existing) {
      verseId = existing.id;
      clientId = existing.client_id;
      progress = existing.progress || DEFAULT_PROGRESS;

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

    // Refresh verses and mastered verses to get latest state
    await Promise.all([
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);

    return resultVerse;
  },

  deleteVerse: async (id: string, collectionId: string): Promise<{ wasMastered: boolean }> => {
    // Get verse info
    const verse = get().verses.find((v) => v.id === id);
    const isMastered = verse?.progress?.hard?.completed === true;

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
      return { wasMastered: isMastered };
    }

    // Remove from junction table (remove from this collection)
    const { error: junctionError } = await supabase
      .from('verse_collections')
      .delete()
      .eq('verse_id', verseData.id)
      .eq('collection_id', collectionData.id);

    if (junctionError) {
      console.error('[STORE] Failed to remove verse from collection:', junctionError);
      return { wasMastered: isMastered };
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

    // Refresh verses and mastered verses
    await Promise.all([
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);

    return { wasMastered: isMastered };
  },

  updateVerseProgress: async (id: string, difficulty: Difficulty, accuracy: number) => {
    // Get current verse from store
    const verse = get().verses.find((v) => v.id === id);
    if (!verse) return;

    const currentBest = verse.progress[difficulty]?.bestAccuracy;

    // Only update if this is a new best score
    if (currentBest === null || accuracy > currentBest) {
      const newProgress = {
        ...verse.progress,
        [difficulty]: {
          bestAccuracy: accuracy,
          completed: accuracy >= 90,
        },
      };

      // Update on server
      const { error } = await supabase
        .from('user_verses')
        .update({ progress: newProgress })
        .eq('client_id', id);

      if (error) {
        console.error('[STORE] Failed to update progress:', error);
        return;
      }

      // Update in store
      set((state) => ({
        verses: state.verses.map((v) =>
          v.id === id ? { ...v, progress: newProgress } : v
        ),
      }));
    }
  },

  resetVerseProgress: async (id: string) => {
    const DEFAULT_PROGRESS = {
      easy: { bestAccuracy: null, completed: false },
      medium: { bestAccuracy: null, completed: false },
      hard: { bestAccuracy: null, completed: false },
    };

    // Update on server
    const { error } = await supabase
      .from('user_verses')
      .update({ progress: DEFAULT_PROGRESS })
      .eq('client_id', id);

    if (error) {
      console.error('[STORE] Failed to reset progress:', error);
      return;
    }

    // Refresh verses and mastered verses to reflect changes
    await Promise.all([
      get().fetchVerses(),
      get().fetchMasteredVerses(),
    ]);
  },

  // ============ RESET ============

  clear: () => {
    set({
      collections: [],
      verses: [],
      masteredVerses: [],
      // Note: colorMode is NOT cleared - it persists across logout
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
 * Get insights stats: mastered count and in-progress count
 */
export function useInsightsStats() {
  const verses = useAppStore(useShallow((state) => state.verses));
  const masteredVerses = useAppStore(useShallow((state) => state.masteredVerses));

  return useMemo(() => {
    const versesMastered = masteredVerses.length;

    // Get unique verse IDs that have any progress but aren't mastered
    const masteredIds = new Set(masteredVerses.map((v) => v.id));
    const inProgressVerses = verses.filter((v) => {
      if (masteredIds.has(v.id)) return false;
      const p = v.progress;
      return (
        p.easy?.bestAccuracy !== null ||
        p.medium?.bestAccuracy !== null ||
        p.hard?.bestAccuracy !== null
      );
    });

    // Deduplicate by verse ID (verse may be in multiple collections)
    const uniqueInProgress = new Set(inProgressVerses.map((v) => v.id));

    return {
      versesMastered,
      inProgress: uniqueInProgress.size,
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
