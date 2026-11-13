/**
 * Zustand Store for User Data
 *
 * Centralized state management for collections and verses.
 * Data is fetched from Supabase and cached in memory.
 * Components subscribe and auto-update when data changes.
 */

import { ensureAuth } from '@/lib/api';
import { fetchVerse, getVerseText } from '@/lib/api/bible';
import { supabase } from '@/lib/api/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CURATED_COLLECTIONS } from '@/lib/collections/catalog';
import { importCollection } from '@/lib/collections/import';
import { validateCollectionPassages } from '@/lib/collections/passages';
import { readCollectionSavers } from '@/lib/collections/savers';
import type { CollectionIconKey } from '@/lib/collections/icons';
import { BIBLE_VERSIONS, type ColorMode } from '@/lib/settings';
import { composeDisplayName } from '@/lib/shared/display-name';
import { isSharedRole, normalizeInviteCode } from '@/lib/shared/invite-code';
import { getSharedMembers, type SharedMember } from '@/lib/shared/invites';
import { canEditShared, collectionRemoval, type ProgressCell, type SharedReference } from '@/lib/shared/progress';
import type { BibleVersion, Collection, Difficulty, SavedVerse, SharedCollectionInfo, SharedRole, SortOption, VerseProgress } from '@/lib/storage';
import { DEFAULT_PROGRESS, DEFAULT_SORT, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID, formatVerseReference, parseCollectionRow, parseProgress, parseVerseRowExtras, updateCollectionSort, updateVerseStudyPrefs } from '@/lib/storage';
import { showErrorToast } from '@/lib/toast';
import type { Database } from '@/supabase/database.types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { create } from 'zustand';

import {
  getInProgressSort,
  getMasteredSort,
  setInProgressSort as persistInProgressSort,
  setMasteredSort as persistMasteredSort,
} from './library-sort';
import { computeNextSrState, hasPracticed, isDueForReview } from './review';
import { DEFAULT_MAX_INTERVAL_DAYS, MAX_USER_MAX_INTERVAL_DAYS, MIN_USER_MAX_INTERVAL_DAYS } from './review-config';
import { compareRecords, isVisible, mayBeMissing, onePerReference, planCollapse, planMoves, referenceKey, seedTranslation, type VerseRecord } from './translation';

const COLOR_MODE_KEY = 'app_color_mode';
// Local cache of the account translation (profiles.translation).
const BIBLE_VERSION_KEY = 'app_bible_version';
const KEPT_NOTICES_KEY = 'translation_kept_notices';
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
  curatedSaverCounts: Partial<Record<string, number>>;
  // Shared collections the user belongs to, by shared_collections.id. See docs/features/shared-collections.md.
  sharedCollections: Record<string, SharedCollectionInfo>;
  // Members × references of a shared collection, fetched when it opens. By shared_collections.id.
  sharedProgress: Record<string, SharedProgress>;

  // Settings
  colorMode: ColorMode;
  bibleVersion: BibleVersion;
  // profiles.display_name: what members of a shared collection see ("Caelan L."). Null until saved.
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  reviewMaxIntervalDays: number;

  // Sort preferences for virtual collections (device-local; mirrored to AsyncStorage)
  masteredSort: SortOption;
  inProgressSort: SortOption;

  // Loading states
  hydrated: boolean;
  collectionsLoading: boolean;
  collectionOrderSaving: boolean;
  versesLoading: boolean;
  masteredLoading: boolean;

  // Error state
  error: string | null;

  // Actions - Fetch
  fetchCollections: () => Promise<boolean>;
  fetchVerses: () => Promise<boolean>;
  fetchMasteredVerses: () => Promise<boolean>;
  fetchCuratedSaverCounts: (signal?: AbortSignal) => Promise<boolean>;
  fetchSharedCollections: () => Promise<boolean>;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;

  // Actions - Settings
  setColorMode: (mode: ColorMode) => Promise<void>;
  setBibleVersion: (version: BibleVersion) => Promise<void>;
  setName: (firstName: string, lastName: string) => Promise<void>;
  setReviewMaxIntervalDays: (days: number) => Promise<void>;

  // Actions - Collections
  addCollection: (name: string, iconKey?: CollectionIconKey) => Promise<Collection>;
  importCuratedCollection: (catalogId: string) => Promise<{ collectionId: string; loaded: boolean }>;
  setCollectionIcon: (id: string, iconKey: CollectionIconKey) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  reorderCollections: (ids: string[]) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  setCollectionSort: (collectionId: string, sort: SortOption) => Promise<void>;

  // Actions - Shared collections. Every failure throws for the caller's toast; nothing is queued.
  shareCollection: (collectionId: string) => Promise<{ sharedId: string; code: string }>;
  stopSharing: (sharedId: string) => Promise<void>;
  mintInvite: (sharedId: string) => Promise<{ code: string; expiresAt: string }>;
  joinSharedCollection: (code: string) => Promise<string>;
  syncSharedCollection: (sharedId: string) => Promise<boolean>;
  fetchSharedProgress: (sharedId: string) => Promise<boolean>;
  openSharedCollection: (sharedId: string) => Promise<boolean>;
  leaveSharedCollection: (sharedId: string) => Promise<void>;
  removeSharedMember: (sharedId: string, userId: string) => Promise<void>;
  setSharedMemberRole: (sharedId: string, userId: string, role: Exclude<SharedRole, 'owner'>) => Promise<void>;

  // Actions - Verses
  addVerse: (
    verse: Omit<SavedVerse, 'id' | 'createdAt' | 'progress' | 'collectionId' | 'version'>,
    collectionId: string,
  ) => Promise<SavedVerse>;
  copyVerseToCollection: (verseId: string, collectionId: string) => Promise<void>;
  deleteVerse: (id: string, collectionId: string) => Promise<{ wasMastered: boolean }>;
  updateVerseProgress: (
    id: string,
    difficulty: Difficulty,
    accuracy: number,
    fullSession?: boolean,
  ) => Promise<void>;
  resetVerseProgress: (id: string) => Promise<void>;
  setVerseStudyPrefs: (id: string, chunkSize: number, difficulty: Difficulty) => void;

  // Reset
  clear: () => void;
}

/** The grid's inputs. `failed` keeps the last good data (fetchedAt 0 if none) and asks for a retry. */
export interface SharedProgress {
  members: SharedMember[];
  references: SharedReference[];
  cells: ProgressCell[];
  fetchedAt: number;
  failed: boolean;
}

// ============ HELPERS ============

// The session ensureAuth just read, so no network round trip; its own error is kept.
async function getCurrentUserId(): Promise<string> {
  await ensureAuth();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Not authenticated');
  return data.session.user.id;
}

let accountGeneration = 0;

function inSharedCollection(state: Pick<AppState, 'verses' | 'collections'>, verseId: string): boolean {
  return state.verses.some((v) => v.id === verseId && state.collections.some((c) => c.id === v.collectionId && c.sharedId));
}
let saverReadGeneration = 0;

async function getCollectionWriteSession(generation: number) {
  const result = await supabase.auth.getSession().catch((error: unknown) => {
    if (generation === accountGeneration) throw error;
    return null;
  });
  if (!result || generation !== accountGeneration) return null;
  if (result.error) throw result.error;
  if (!result.data.session) throw new Error('Not authenticated');
  return result.data.session;
}

type VerseRow = Database['public']['Tables']['user_verses']['Row'];
// The shared client isn't typed with Database; this view of it is, for the shared-collection calls.
const db: SupabaseClient<Database> = supabase;
type VerseMembershipRow = { user_verses: VerseRow; added_at: string };

function parseVerseMembership(row: VerseRow, collectionId: string, addedAt: string): SavedVerse {
  return {
    id: row.client_id,
    collectionId,
    book: row.book,
    chapter: row.chapter,
    verseStart: row.verse_start,
    verseEnd: row.verse_end,
    version: row.version as BibleVersion,
    createdAt: new Date(addedAt).getTime(),
    progress: parseProgress(row.progress),
    ...parseVerseRowExtras(row),
  };
}

function isBibleVersion(value: unknown): value is BibleVersion {
  return BIBLE_VERSIONS.some((version) => version.value === value);
}

type VerseIdentityRow = Pick<VerseRow, 'id' | 'client_id' | 'book' | 'chapter' | 'verse_start' | 'verse_end' | 'version' | 'progress' | 'deleted_at'>;
type HeldVerse = VerseRecord & { clientId: string };
const VERSE_IDENTITY_COLUMNS = 'id, client_id, book, chapter, verse_start, verse_end, version, progress, deleted_at';

function toRecord(row: VerseIdentityRow): HeldVerse {
  return {
    id: row.id,
    clientId: row.client_id,
    book: row.book,
    chapter: row.chapter,
    verseStart: row.verse_start,
    verseEnd: row.verse_end,
    version: row.version,
    progress: parseProgress(row.progress),
    deleted: row.deleted_at !== null,
  };
}

// Translation sync and switches touch every verse row, so they run one at a time.
let translationWork: Promise<unknown> = Promise.resolve();
function queueTranslationWork<T>(work: () => Promise<T>): Promise<T> {
  const next = translationWork.then(work, work);
  translationWork = next.catch(() => undefined);
  return next;
}

// The latest translation picked and not yet saved. Sync leaves the store alone meanwhile.
let requestedTranslation: BibleVersion | null = null;

// No offline queue (invariant 10): say so, and the next hydrate or pull to refresh retries.
// A sync for an account that has since signed out says nothing.
function reportSyncFailure(generation: number) {
  return (e: unknown) => {
    if (generation !== accountGeneration) return;
    console.error('[STORE] Failed to sync translation:', e);
    showErrorToast("Couldn't line your verses up with your translation. Pull to refresh to try again.");
  };
}

// The winner takes the losers' collections, then the losers are deleted for good, so a
// reset or removed winner is never replaced by its twin. session_attempts has no foreign
// key to user_verses, so their history stays.
// A delete that RLS filters out returns no error, so the deleted ids are counted.
async function hardDeleteVerses(ids: string[]) {
  const { data, error } = await supabase.from('user_verses').delete().in('id', ids).select('id');
  if (error) throw error;
  if (data.length !== ids.length) throw new Error(`Deleted ${data.length} of ${ids.length} verses`);
}

async function collapseVerse(winner: HeldVerse, losers: HeldVerse[]) {
  const loserIds = losers.map(({ id }) => id);
  const { data: links, error } = await supabase
    .from('verse_collections')
    .select('collection_id, added_at')
    .in('verse_id', loserIds);
  if (error) throw error;
  if (links.length > 0) {
    const { error: linkError } = await supabase
      .from('verse_collections')
      .upsert(
        links.map(({ collection_id, added_at }) => ({ verse_id: winner.id, collection_id, added_at })),
        { onConflict: 'verse_id,collection_id', ignoreDuplicates: true },
      );
    if (linkError) throw linkError;
  }

  await hardDeleteVerses(loserIds);
}

async function isAvailableIn(verse: HeldVerse, translation: BibleVersion): Promise<boolean> {
  try {
    const { verses } = await fetchVerse(formatVerseReference(verse), translation);
    for (let n = verse.verseStart; n <= verse.verseEnd; n++) {
      if (!verses?.[n]?.trim()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes every verse follow the account translation: collapses two active translations
 * of one reference into the row with better progress, then moves each reference to
 * `translation` (`planMoves`). A verse the translation leaves out keeps its version.
 * Returns those kept rows. `rows` saves a read when the caller already has them.
 */
async function alignVerses(userId: string, translation: BibleVersion, rows?: VerseIdentityRow[]): Promise<HeldVerse[]> {
  let records = rows?.map(toRecord);
  if (!records) {
    const { data, error } = await supabase.from('user_verses').select(VERSE_IDENTITY_COLUMNS).eq('user_id', userId);
    if (error) throw error;
    records = data.map(toRecord);
  }

  const merged = new Set<string>();
  for (const { winner, losers } of planCollapse(records, translation)) {
    await collapseVerse(winner, losers);
    for (const { id } of losers) merged.add(id);
  }
  records = records.filter(({ id }) => !merged.has(id));

  const kept = new Set<string>();
  const available = new Map<string, boolean>();
  for (const { id } of planMoves(records, translation)) {
    const record = records.find((r) => r.id === id)!;
    if (record.version === translation || !mayBeMissing(record)) continue;
    const key = referenceKey(record);
    if (!available.has(key)) available.set(key, await isAvailableIn(record, translation));
    if (!available.get(key)) kept.add(id);
  }

  const moves = planMoves(records, translation, ({ id }) => kept.has(id));
  // Rows giving the translation up go first, so two rows never share it.
  for (const { id, version } of moves.filter((move) => move.version !== translation)) {
    const { error } = await supabase.from('user_verses').update({ version }).eq('id', id);
    if (error) throw error;
  }
  const movers = moves.filter((move) => move.version === translation).map(({ id }) => id);
  if (movers.length > 0) {
    const { error } = await supabase.from('user_verses').update({ version: translation }).in('id', movers);
    if (error) throw error;
  }
  return records.filter(({ id }) => kept.has(id)).filter(isVisible);
}

/** Tells the user, once per verse and translation, which verses stayed in their old translation. */
async function tellKeptVerses(kept: HeldVerse[], translation: BibleVersion) {
  let told: string[] = [];
  try {
    told = JSON.parse((await AsyncStorage.getItem(KEPT_NOTICES_KEY)) ?? '[]');
  } catch (e) {
    console.error('[STORE] Failed to read translation notices:', e);
  }
  const fresh = kept.filter(({ clientId }) => !told.includes(`${clientId}:${translation}`));
  if (fresh.length === 0) return;

  const references = [...new Set(fresh.map((verse) => formatVerseReference(verse)))];
  Alert.alert(
    `Not in the ${translation}`,
    references.length === 1
      ? `${references[0]} isn't in the ${translation}, so it stays in the ${fresh[0].version}.`
      : `${references.slice(0, -1).join(', ')} and ${references[references.length - 1]} aren't in the ${translation}, so they stay in their current translation.`,
  );
  try {
    await AsyncStorage.setItem(KEPT_NOTICES_KEY, JSON.stringify([...told, ...fresh.map(({ clientId }) => `${clientId}:${translation}`)]));
  } catch (e) {
    console.error('[STORE] Failed to save translation notices:', e);
  }
}

/**
 * Reads the account translation from `profiles` into the store and its local cache.
 * An account with none yet gets this device's translation, which is how devices
 * from before account translations carry their choice over. Then lines the
 * verses up with it.
 */
async function syncAccountTranslation(generation: number) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from('profiles').select('translation, display_name, first_name, last_name').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (generation !== accountGeneration) return;
  useAppStore.setState({
    displayName: data?.display_name ?? null,
    firstName: data?.first_name ?? null,
    lastName: data?.last_name ?? null,
  });

  let translation: BibleVersion;
  let rows: VerseIdentityRow[] | undefined;
  if (data?.translation) {
    // A newer app version may know translations this one doesn't. Leave it alone.
    if (!isBibleVersion(data.translation)) return;
    translation = data.translation;
    if (requestedTranslation === null) {
      useAppStore.setState({ bibleVersion: translation });
      await AsyncStorage.setItem(BIBLE_VERSION_KEY, translation).catch((e) => {
        console.error('[STORE] Failed to cache bibleVersion:', e);
      });
    }
  } else {
    // No profile yet: keep the verses where most of them already are.
    const { data: held, error: heldError } = await supabase.from('user_verses').select(VERSE_IDENTITY_COLUMNS).eq('user_id', userId);
    if (heldError) throw heldError;
    rows = held;
    translation = seedTranslation(held.map(toRecord), useAppStore.getState().bibleVersion, isBibleVersion);
    const { error: saveError } = await supabase.from('profiles').upsert({ user_id: userId, translation });
    if (saveError) throw saveError;
    if (generation !== accountGeneration) return;
    if (requestedTranslation === null) {
      useAppStore.setState({ bibleVersion: translation });
      await AsyncStorage.setItem(BIBLE_VERSION_KEY, translation).catch((e) => {
        console.error('[STORE] Failed to cache bibleVersion:', e);
      });
    }
  }

  const kept = await alignVerses(userId, translation, rows);
  if (generation === accountGeneration) await tellKeptVerses(kept, translation);
}

// ============ SHARED COLLECTIONS ============

function sharedIdOf(collectionId: string): string | undefined {
  return useAppStore.getState().collections.find((c) => c.id === collectionId)?.sharedId;
}

function sharedRole(sharedId: string): SharedRole {
  const role = useAppStore.getState().sharedCollections[sharedId]?.role;
  if (!role) throw new Error("This shared collection hasn't loaded. Pull to refresh.");
  return role;
}

// After a change to the group's verses or members, the grid follows if this device has it open.
async function refetchLoadedProgress(sharedId: string) {
  if (useAppStore.getState().sharedProgress[sharedId]) await useAppStore.getState().fetchSharedProgress(sharedId);
}

// The groups this account was in at the last fetch, per account on this device, so a group that
// is gone by the next fetch gets one notice. Owned groups only go by the owner's own delete.
type KnownGroup = { id: string; name: string; owned: boolean };
const knownGroupsKey = (userId: string) => `shared_known_groups:${userId}`;
let knownGroupsQueue: Promise<unknown> = Promise.resolve();

function withKnownGroups(userId: string, work: (known: KnownGroup[] | null) => Promise<KnownGroup[]>) {
  const next = knownGroupsQueue.then(async () => {
    const raw = await AsyncStorage.getItem(knownGroupsKey(userId));
    const groups = await work(raw ? JSON.parse(raw) : null);
    await AsyncStorage.setItem(knownGroupsKey(userId), JSON.stringify(groups));
  });
  knownGroupsQueue = next.catch(() => {});
  return next;
}

// A member's copy stays active when the owner deleted the group, and is soft-deleted when they were removed.
async function noticeDepartedGroups(userId: string, current: KnownGroup[], generation: number) {
  await withKnownGroups(userId, async (known) => {
    const gone = (known ?? []).filter((g) => !g.owned && !current.some((c) => c.id === g.id));
    if (gone.length === 0) return current;
    const { data, error } = await db.from('user_collections').select('client_id')
      .in('client_id', gone.map((g) => `shared-${g.id}`)).is('deleted_at', null);
    if (error) throw error;
    const kept = new Set(data.map((row) => row.client_id));
    if (generation === accountGeneration) {
      showErrorToast(gone.map((g) => kept.has(`shared-${g.id}`)
        ? `${g.name} is now your own copy.`
        : `You were removed from ${g.name}.`).join('\n'));
    }
    return current;
  });
}

function sameReference(a: Pick<SavedVerse, 'book' | 'chapter' | 'verseStart' | 'verseEnd'>, b: typeof a) {
  return a.book === b.book && a.chapter === b.chapter && a.verseStart === b.verseStart && a.verseEnd === b.verseEnd;
}

// Owners and editors add to the group's reference list; sync then makes their own copy match.
async function addSharedVerse(
  sharedId: string,
  collectionId: string,
  verse: Pick<SavedVerse, 'book' | 'chapter' | 'verseStart' | 'verseEnd'>,
): Promise<SavedVerse> {
  if (!canEditShared(sharedRole(sharedId))) throw new Error('Only the owner and editors can add verses here.');
  const { error } = await db.from('shared_collection_verses').insert({
    shared_collection_id: sharedId,
    book: verse.book,
    chapter: verse.chapter,
    verse_start: verse.verseStart,
    verse_end: verse.verseEnd,
  });
  // Already a reference (another editor added it): sync still links the copy.
  if (error && error.code !== '23505') throw error;
  await useAppStore.getState().syncSharedCollection(sharedId);
  await refetchLoadedProgress(sharedId);
  const find = () => useAppStore.getState().verses.find((v) => v.collectionId === collectionId && sameReference(v, verse));
  if (!find()) await useAppStore.getState().fetchVerses();
  const added = find();
  if (!added) throw new Error('Failed to add verse to collection');
  return added;
}

// ============ STORE ============

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  collections: [],
  verses: [],
  masteredVerses: [],
  curatedSaverCounts: {},
  sharedCollections: {},
  sharedProgress: {},
  colorMode: 'system',
  bibleVersion: 'ESV',
  displayName: null,
  firstName: null,
  lastName: null,
  reviewMaxIntervalDays: DEFAULT_MAX_INTERVAL_DAYS,
  // Mastered defaults to due-first (review-aware default). Overwritten
  // by hydrate() if AsyncStorage has a saved value. In Progress and
  // user collections default to 'recent'.
  masteredSort: 'due-first',
  inProgressSort: DEFAULT_SORT,
  hydrated: false,
  collectionsLoading: true,
  collectionOrderSaving: false,
  versesLoading: true,
  masteredLoading: true,
  error: null,

  // ============ FETCH ACTIONS ============

  fetchCuratedSaverCounts: async (signal) => {
    const generation = accountGeneration;
    const request = ++saverReadGeneration;
    try {
      const session = await getCollectionWriteSession(generation);
      if (!session || signal?.aborted) return false;
      const counts = await readCollectionSavers(supabase, session, signal);
      const current = await getCollectionWriteSession(generation);
      if (signal?.aborted || request !== saverReadGeneration
        || generation !== accountGeneration || current?.user.id !== session.user.id) return false;
      set({ curatedSaverCounts: counts });
      return true;
    } catch {
      return false;
    }
  },

  fetchCollections: async () => {
    if (get().collectionOrderSaving) return true;
    const generation = accountGeneration;
    const previousCollections = get().collections;
    set({ collectionsLoading: true });
    try {
      const { data, error } = await supabase
        .from('user_collections')
        .select('*')
        .is('deleted_at', null)
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('client_id', { ascending: true });

      if (generation !== accountGeneration) return false;
      if (error) {
        console.error('[STORE] Failed to fetch collections:', error);
        // Keep existing state, set error
        set({ collectionsLoading: false, error: 'Failed to load collections' });
        return false;
      }

      const collections = data.map(parseCollectionRow);

      const pinned = [
        collections.find((c) => c.isDefault) ?? DEFAULT_COLLECTION,
        MASTERED_COLLECTION,
        IN_PROGRESS_COLLECTION,
      ];
      set((state) => ({
        // An older refresh must not replace a collection write made during the request.
        collections: state.collections === previousCollections
          ? [...pinned, ...collections.filter((c) => !c.isDefault)]
          : state.collections,
        collectionsLoading: false,
        error: null,
      }));
      return true;
    } catch (e) {
      if (generation !== accountGeneration) return false;
      console.error('[STORE] Collection fetch error:', e);
      // Keep existing state, set error
      set({ collectionsLoading: false, error: 'Failed to load collections' });
      return false;
    }
  },

  fetchVerses: async () => {
    const generation = accountGeneration;
    const previousVerses = get().verses;
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
        .order('added_at', { ascending: false })
        .overrideTypes<(VerseMembershipRow & { user_collections: { client_id: string } })[], { merge: false }>();

      if (generation !== accountGeneration) return false;
      if (error) {
        console.error('[STORE] Failed to fetch verses:', error);
        // Keep existing state, set error
        set({ versesLoading: false, error: 'Failed to load verses' });
        return false;
      }

      // Map junction rows to SavedVerse (one entry per collection membership)
      const verses = data.map((vc) =>
        parseVerseMembership(vc.user_verses, vc.user_collections.client_id, vc.added_at)
      );

      set((state) => ({
        verses: state.verses === previousVerses ? verses : state.verses,
        versesLoading: false,
        error: null,
      }));
      return true;
    } catch (e) {
      if (generation !== accountGeneration) return false;
      console.error('[STORE] Verse fetch error:', e);
      // Keep existing state, set error
      set({ versesLoading: false, error: 'Failed to load verses' });
      return false;
    }
  },

  fetchMasteredVerses: async () => {
    const generation = accountGeneration;
    set({ masteredLoading: true });
    try {
      // Fetch mastered verses directly from DB - NO deleted_at filter
      // This includes soft-deleted verses so they stay in Mastered list
      const { data, error } = await supabase
        .from('user_verses')
        .select('*')
        .eq('progress->hard->completed', true)
        .order('updated_at', { ascending: false });

      if (generation !== accountGeneration) return false;
      if (error) {
        console.error('[STORE] Failed to fetch mastered verses:', error);
        set({ masteredLoading: false });
        return false;
      }

      // Two translations of one verse can both be mastered. List the better one.
      const shown = new Set(onePerReference(data.map(toRecord), get().bibleVersion).map(({ id }) => id));
      const masteredVerses: SavedVerse[] = data.filter((v) => shown.has(v.id)).map((v) => ({
        id: v.client_id,
        collectionId: MASTERED_COLLECTION_ID,
        book: v.book,
        chapter: v.chapter,
        verseStart: v.verse_start,
        verseEnd: v.verse_end,
        version: v.version as BibleVersion,
        createdAt: new Date(v.created_at).getTime(),
        progress: parseProgress(v.progress),
        ...parseVerseRowExtras(v),
      }));

      set({ masteredVerses, masteredLoading: false });
      return true;
    } catch (e) {
      if (generation !== accountGeneration) return false;
      console.error('[STORE] Mastered verses fetch error:', e);
      set({ masteredLoading: false });
      return false;
    }
  },

  fetchSharedCollections: async () => {
    const generation = accountGeneration;
    try {
      const userId = await getCurrentUserId();
      const [groups, mine, status] = await Promise.all([
        db.from('shared_collections').select('id, name'),
        db.from('shared_collection_members').select('shared_collection_id, role').eq('user_id', userId),
        db.rpc('get_shared_status'),
      ]);
      if (generation !== accountGeneration) return false;
      if (groups.error) throw groups.error;
      if (mine.error) throw mine.error;
      if (status.error) throw status.error;

      const roles = new Map(mine.data.map((m) => [m.shared_collection_id, m.role]));
      const counts = new Map(status.data.map((row) => [row.shared_id, row]));
      // Library cards name the owner. `profiles` is private to each user, so a joined group's owner
      // comes from its member list, one read per joined group (20 at most); a failed read leaves no name.
      const ownerNames = new Map(await Promise.all(groups.data
        .filter((group) => roles.get(group.id) !== 'owner' && counts.has(group.id))
        .map(async (group) => [group.id, await getSharedMembers(group.id)
          .then((members) => members.find((m) => m.role === 'owner')?.displayName ?? null, () => null)] as const)));
      if (generation !== accountGeneration) return false;
      const sharedCollections: Record<string, SharedCollectionInfo> = {};
      for (const group of groups.data) {
        const role = roles.get(group.id);
        const count = counts.get(group.id);
        if (!isSharedRole(role) || !count) continue;
        sharedCollections[group.id] = {
          id: group.id,
          ownerName: ownerNames.get(group.id) ?? null,
          name: group.name,
          role,
          memberCount: count.member_count,
          verseCount: count.verse_count,
          masteredSquares: count.mastered_squares,
          engravedSquares: count.engraved_squares,
        };
      }
      set({ sharedCollections });
      const current = Object.values(sharedCollections).map((g) => ({ id: g.id, name: g.name, owned: g.role === 'owner' }));
      await noticeDepartedGroups(userId, current, generation)
        .catch((e) => console.error('[STORE] Failed to check for removed shared collections:', e));
      return true;
    } catch (e) {
      if (generation !== accountGeneration) return false;
      console.error('[STORE] Failed to fetch shared collections:', e);
      return false;
    }
  },

  hydrate: async () => {
    const generation = accountGeneration;
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
      if (isBibleVersion(savedBibleVersion)) {
        updates.bibleVersion = savedBibleVersion;
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

    if (generation !== accountGeneration) return;
    // The cached translation stands in when the profile can't be read (offline).
    await queueTranslationWork(() => syncAccountTranslation(generation)).catch(reportSyncFailure(generation));
    if (generation !== accountGeneration) return;
    let [collectionsOk, versesOk, masteredOk, sharedOk] = await Promise.all([
      get().fetchCollections(),
      get().fetchVerses(),
      get().fetchMasteredVerses(),
      get().fetchSharedCollections(),
    ]);
    if (generation !== accountGeneration) return;

    // Retry once after short delay if any fetch failed (handles auth propagation race)
    if (!collectionsOk || !versesOk || !masteredOk || !sharedOk) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (generation !== accountGeneration) return;
      [collectionsOk, versesOk, masteredOk, sharedOk] = await Promise.all([
        collectionsOk ? true : get().fetchCollections(),
        versesOk ? true : get().fetchVerses(),
        masteredOk ? true : get().fetchMasteredVerses(),
        sharedOk ? true : get().fetchSharedCollections(),
      ]);
      if (generation !== accountGeneration) return;
    }

    // Always mark as hydrated so UI can render (partial data is better than nothing)
    set({ hydrated: true });

    // Show toast only if retry also failed
    if (!collectionsOk || !versesOk || !masteredOk || !sharedOk) {
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
    const generation = accountGeneration;
    await queueTranslationWork(() => syncAccountTranslation(generation)).catch(reportSyncFailure(generation));
    await Promise.all([
      get().fetchCollections(),
      get().fetchVerses(),
      get().fetchMasteredVerses(),
      get().fetchCuratedSaverCounts(),
      get().fetchSharedCollections(),
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

  // The account translation: saved to the profile, then every verse moves to it.
  setBibleVersion: async (version: BibleVersion) => {
    const previous = get().bibleVersion;
    if (version === previous) return;
    const generation = accountGeneration;
    set({ bibleVersion: version });
    requestedTranslation = version;

    let saved = false;
    try {
      const kept = await queueTranslationWork(async () => {
        // A later choice replaced this one before it ran.
        if (generation !== accountGeneration || requestedTranslation !== version) return [];
        const userId = await getCurrentUserId();
        const { error } = await supabase.from('profiles').upsert({ user_id: userId, translation: version });
        if (error) throw error;
        saved = true;
        requestedTranslation = null;
        set({ bibleVersion: version });

        await AsyncStorage.setItem(BIBLE_VERSION_KEY, version).catch((e) => {
          console.error('[STORE] Failed to cache bibleVersion:', e);
        });
        return alignVerses(userId, version);
      });
      if (generation !== accountGeneration) return;
      await Promise.all([get().fetchVerses(), get().fetchMasteredVerses()]);
      await tellKeptVerses(kept, version);
    } catch (e) {
      console.error('[STORE] Failed to change translation:', e);
      if (generation !== accountGeneration) return;
      if (saved) {
        // The profile is right; the next hydrate or pull to refresh moves the rest.
        showErrorToast("Some verses didn't switch translation. Pull to refresh to try again.");
      } else {
        if (requestedTranslation === version) requestedTranslation = null;
        if (get().bibleVersion === version) set({ bibleVersion: previous });
        showErrorToast("Couldn't change your translation. Try again.");
      }
    }
  },

  setName: async (first: string, last: string) => {
    const previous = { displayName: get().displayName, firstName: get().firstName, lastName: get().lastName };
    const firstName = first.trim();
    const lastName = last.trim() || null;
    if (firstName === previous.firstName && lastName === previous.lastName) return;
    const next = { displayName: composeDisplayName(firstName, lastName), firstName, lastName };
    const generation = accountGeneration;
    set(next);
    try {
      const userId = await getCurrentUserId();
      const { error } = await supabase.from('profiles').upsert({
        user_id: userId, display_name: next.displayName, first_name: firstName, last_name: lastName,
      });
      if (error) throw error;
    } catch (e) {
      console.error('[STORE] Failed to save name:', e);
      if (generation !== accountGeneration) return;
      if (get().firstName === firstName && get().lastName === lastName) set(previous);
      showErrorToast("Couldn't save your name. Try again.");
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

  addCollection: async (name, iconKey) => {
    const userId = await getCurrentUserId();
    const clientId = `collection-${Date.now()}`;
    const createdAt = new Date();

    const { error } = await supabase.from('user_collections').insert({
      user_id: userId,
      client_id: clientId,
      name,
      is_default: false,
      ...(iconKey ? { icon_key: iconKey } : {}),
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
      iconKey,
      createdAt: createdAt.getTime(),
    };

    // Optimistically add to store
    set((state) => ({
      collections: [...state.collections, newCollection],
    }));

    return newCollection;
  },

  importCuratedCollection: async (catalogId) => {
    const catalog = CURATED_COLLECTIONS.find(({ id }) => id === catalogId);
    if (!catalog) throw new Error('Collection not found.');
    const version = get().bibleVersion;

    const generation = accountGeneration;
    const session = await getCollectionWriteSession(generation);
    if (!session || generation !== accountGeneration) throw new Error('Your account changed.');

    await validateCollectionPassages(catalog.passages, version, fetchVerse);
    const current = await getCollectionWriteSession(generation);
    if (current?.user.id !== session.user.id || generation !== accountGeneration) {
      throw new Error('Your account changed.');
    }
    const { collectionId, row } = await importCollection(supabase, current, catalogId, version, () => {
      if (generation === accountGeneration) void get().fetchCuratedSaverCounts();
    });
    if (generation !== accountGeneration) throw new Error('Your account changed.');
    if (!row) return { collectionId, loaded: false };

    const collection = parseCollectionRow(row);
    const verses = row.verse_collections.map(({ user_verses, added_at }) =>
      parseVerseMembership(user_verses, collection.id, added_at),
    );
    set((state) => ({
      collections: state.collections.some(({ id }) => id === collection.id)
        ? state.collections.map((current) => current.id === collection.id ? collection : current)
        : [...state.collections, collection],
      verses: [...verses, ...state.verses.filter(({ collectionId: id }) => id !== collection.id)],
    }));
    return { collectionId, loaded: true };
  },

  setCollectionIcon: async (id, iconKey) => {
    const generation = accountGeneration;
    const collection = get().collections.find((item) => item.id === id);
    if (!collection || collection.isDefault || collection.isVirtual) {
      throw new Error('This collection’s icon cannot be changed.');
    }

    const session = await getCollectionWriteSession(generation);
    if (!session || generation !== accountGeneration) throw new Error('Your account changed.');
    // Members' copies follow on their next sync.
    if (collection.sharedId) {
      if (sharedRole(collection.sharedId) !== 'owner') throw new Error('Only the owner can change this icon.');
      const { data: group, error: groupError } = await db.from('shared_collections')
        .update({ icon_key: iconKey }).eq('id', collection.sharedId).select('id');
      if (groupError || group.length !== 1) throw new Error('Could not save the collection icon. Try again.');
    }
    const { data, error } = await supabase
      .from('user_collections')
      .update({ icon_key: iconKey })
      .eq('user_id', session.user.id)
      .eq('client_id', id)
      .eq('is_default', false)
      .is('deleted_at', null)
      .setHeader('Authorization', `Bearer ${session.access_token}`)
      .select('icon_key')
      .single();

    if (generation !== accountGeneration) throw new Error('Your account changed.');
    if (error || !data) throw new Error('Could not save the collection icon. Try again.');
    set((state) => ({
      collections: state.collections.map((current) => current.id === id ? { ...current, iconKey } : current),
    }));
  },

  renameCollection: async (id, name) => {
    const generation = accountGeneration;
    const trimmed = name.trim();
    const collection = get().collections.find((c) => c.id === id);
    if (!trimmed || !collection || collection.isDefault || collection.isVirtual) {
      throw new Error('Cannot rename this collection');
    }

    const session = await getCollectionWriteSession(generation);
    if (!session || generation !== accountGeneration) return;
    // Members' copies follow on their next sync.
    if (collection.sharedId) {
      if (sharedRole(collection.sharedId) !== 'owner') throw new Error('Only the owner can rename this collection.');
      const { data: group, error: groupError } = await db.from('shared_collections')
        .update({ name: trimmed }).eq('id', collection.sharedId).select('id');
      if (groupError) throw groupError;
      if (group.length !== 1) throw new Error('Could not rename this collection.');
    }
    const { data, error } = await supabase.from('user_collections')
      .update({ name: trimmed })
      .eq('user_id', session.user.id)
      .eq('client_id', id)
      .eq('is_default', false)
      .is('deleted_at', null)
      .select('name')
      .single()
      .setHeader('Authorization', `Bearer ${session.access_token}`);
    if (generation !== accountGeneration) return;
    if (error) throw error;

    set((state) => ({
      collections: state.collections.map((c) => c.id === id ? { ...c, name: data.name } : c),
    }));
  },

  reorderCollections: async (ids) => {
    if (get().collectionOrderSaving) return;
    const generation = accountGeneration;
    const previous = get().collections;
    const custom = previous.filter((c) => !c.isDefault && !c.isVirtual);
    const byId = new Map(custom.map((c) => [c.id, c]));
    const ordered = ids.flatMap((id) => byId.get(id) ?? []);
    if (ordered.length !== custom.length || ordered.length !== ids.length || new Set(ids).size !== ids.length) {
      throw new Error('Collection list changed');
    }

    const collections = [...previous.filter((c) => c.isDefault || c.isVirtual), ...ordered];
    set({ collections, collectionOrderSaving: true });
    try {
      const session = await getCollectionWriteSession(generation);
      if (!session || generation !== accountGeneration) return;
      const { error } = await supabase.rpc('reorder_collections', { collection_ids: ids })
        .setHeader('Authorization', `Bearer ${session.access_token}`);
      if (generation !== accountGeneration) return;
      if (error) throw error;
    } catch (error) {
      if (generation !== accountGeneration) return;
      set((state) => ({
        collections: state.collections === collections ? previous : state.collections,
        collectionOrderSaving: false,
      }));
      await get().fetchCollections();
      if (generation === accountGeneration) throw error;
      return;
    }
    set({ collectionOrderSaving: false });
  },

  deleteCollection: async (id: string) => {
    if (id === DEFAULT_COLLECTION_ID) return;

    // A member's delete is leave. The owner's stops sharing first: every member keeps their
    // copy (docs/features/shared-collections.md#dissolve), then the owner's goes as below.
    const sharedId = sharedIdOf(id);
    if (sharedId) {
      if (collectionRemoval(sharedId, sharedRole(sharedId)) === 'leave') {
        await get().leaveSharedCollection(sharedId);
        return;
      }
      await get().stopSharing(sharedId);
    }

    // One transaction on the server: every verse leaves, held-elsewhere verses stay, and the
    // collection goes, or nothing changes (supabase/migrations/*_delete_collection.sql).
    const generation = accountGeneration;
    const session = await getCollectionWriteSession(generation);
    if (!session || generation !== accountGeneration) return;
    const { error } = await supabase.rpc('delete_collection', { collection_client_id: id })
      .setHeader('Authorization', `Bearer ${session.access_token}`);
    if (generation !== accountGeneration) return;
    if (error) {
      console.error('[STORE] Failed to delete collection:', error);
      throw new Error('Failed to delete collection');
    }

    // Mastered verses held nowhere else stay on the Mastered list (soft-deleted).
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      verses: state.verses.filter((v) => v.collectionId !== id),
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

  // ============ SHARED COLLECTION ACTIONS ============

  shareCollection: async (collectionId) => {
    const generation = accountGeneration;
    const { data, error } = await db.rpc('share_collection', { p_collection_client_id: collectionId });
    if (error) throw error;
    const row = data[0];
    if (!row) throw new Error('Could not share this collection.');
    if (generation !== accountGeneration) throw new Error('Your account changed.');
    set((state) => ({
      collections: state.collections.map((c) => c.id === collectionId ? { ...c, sharedId: row.shared_id } : c),
    }));
    await get().fetchSharedCollections();
    return { sharedId: row.shared_id, code: row.code };
  },

  // Deletes the group: its codes die, members keep a personal copy, and the owner's copy is a
  // plain collection again.
  stopSharing: async (sharedId) => {
    if (sharedRole(sharedId) !== 'owner') throw new Error('Only the owner can stop sharing.');
    const { data: group, error } = await db.from('shared_collections').delete().eq('id', sharedId).select('id');
    if (error) throw error;
    if (group.length !== 1) throw new Error('Could not stop sharing this collection.');
    set((state) => ({
      collections: state.collections.map((c) => c.sharedId === sharedId ? { ...c, sharedId: undefined } : c),
      sharedCollections: Object.fromEntries(Object.entries(state.sharedCollections).filter(([key]) => key !== sharedId)),
      sharedProgress: Object.fromEntries(Object.entries(state.sharedProgress).filter(([key]) => key !== sharedId)),
    }));
  },

  mintInvite: async (sharedId) => {
    const { data, error } = await db.rpc('mint_invite', { p_shared: sharedId });
    if (error) throw error;
    if (!data[0]) throw new Error('Could not make a new link.');
    return { code: data[0].code, expiresAt: data[0].expires_at };
  },

  // Returns the joined collection's client_id. Joining twice only syncs.
  joinSharedCollection: async (code) => {
    const { data, error } = await db.rpc('join_shared_collection', {
      p_code: normalizeInviteCode(code),
      p_version: get().bibleVersion,
    });
    if (error) throw error;
    await get().refresh();
    return data;
  },

  // Makes the user's copy match the group; refetches only when the server changed something.
  syncSharedCollection: async (sharedId) => {
    const { data, error } = await db.rpc('sync_shared_collection', {
      p_shared: sharedId,
      p_version: get().bibleVersion,
    });
    if (error) throw error;
    const changed = data[0]?.changed ?? false;
    if (changed) {
      await Promise.all([get().fetchCollections(), get().fetchVerses(), get().fetchSharedCollections()]);
    }
    return changed;
  },

  // Never throws: a failure is kept on the entry for the screen's retry.
  fetchSharedProgress: async (sharedId) => {
    const generation = accountGeneration;
    try {
      const [members, progress, references] = await Promise.all([
        getSharedMembers(sharedId),
        db.rpc('get_shared_progress', { p_shared: sharedId }),
        db.from('shared_collection_verses').select('book, chapter, verse_start, verse_end')
          .eq('shared_collection_id', sharedId).order('added_at'),
      ]);
      if (generation !== accountGeneration) return false;
      if (progress.error) throw progress.error;
      if (references.error) throw references.error;
      const entry: SharedProgress = {
        members,
        references: references.data.map((r) => ({ book: r.book, chapter: r.chapter, verseStart: r.verse_start, verseEnd: r.verse_end })),
        cells: progress.data.map((c) => ({
          userId: c.user_id,
          book: c.book,
          chapter: c.chapter,
          verseStart: c.verse_start,
          verseEnd: c.verse_end,
          practiced: c.practiced,
          mastered: c.mastered,
          engraved: c.engraved,
        })),
        fetchedAt: Date.now(),
        failed: false,
      };
      set((state) => ({ sharedProgress: { ...state.sharedProgress, [sharedId]: entry } }));
      return true;
    } catch (e) {
      if (generation !== accountGeneration) return false;
      console.error('[STORE] Failed to fetch shared progress:', e);
      set((state) => {
        const prior = state.sharedProgress[sharedId] ?? { members: [], references: [], cells: [], fetchedAt: 0, failed: true };
        return { sharedProgress: { ...state.sharedProgress, [sharedId]: { ...prior, failed: true } } };
      });
      return false;
    }
  },

  // Opening a shared collection: bring the copy up to date, then read the grid, the group row (a
  // role the owner changed since the last refresh) and the user's own copies. A failed sync throws
  // after the reads, unless they show the membership gone: then the departed-group notice is the
  // message and it returns false. A failed grid read shows on the entry.
  openSharedCollection: async (sharedId) => {
    let changed = false;
    let failure: unknown = null;
    try {
      changed = await get().syncSharedCollection(sharedId);
    } catch (e) {
      failure = e;
    }
    // A sync that changed something has already refetched. One that didn't still reloads: the
    // server applies a removed reference, a removal or a dissolve to this copy without the sync.
    // After a failed sync the membership may be gone, so the grid waits for the reload to say.
    await Promise.all([
      failure ? null : get().fetchSharedProgress(sharedId),
      changed || Promise.all([get().fetchCollections(), get().fetchVerses(), get().fetchSharedCollections()]),
    ]);
    if (!get().collections.some((c) => c.sharedId === sharedId)) {
      set((state) => ({
        sharedProgress: Object.fromEntries(Object.entries(state.sharedProgress).filter(([key]) => key !== sharedId)),
      }));
      return false;
    }
    if (failure) {
      await get().fetchSharedProgress(sharedId);
      throw failure;
    }
    return true;
  },

  leaveSharedCollection: async (sharedId) => {
    const generation = accountGeneration;
    const userId = await getCurrentUserId();
    const { error } = await supabase.rpc('leave_shared_collection', { p_shared: sharedId });
    if (generation !== accountGeneration) return;
    if (error) throw error;
    await withKnownGroups(userId, async (known) => (known ?? []).filter((g) => g.id !== sharedId))
      .catch((e) => console.error('[STORE] Failed to forget a left shared collection:', e));
    if (generation !== accountGeneration) return;
    const gone = new Set(get().collections.filter((c) => c.sharedId === sharedId).map((c) => c.id));
    set((state) => ({
      collections: state.collections.filter((c) => !gone.has(c.id)),
      verses: state.verses.filter((v) => !gone.has(v.collectionId)),
      sharedCollections: Object.fromEntries(Object.entries(state.sharedCollections).filter(([key]) => key !== sharedId)),
      sharedProgress: Object.fromEntries(Object.entries(state.sharedProgress).filter(([key]) => key !== sharedId)),
    }));
    // The server applied the delete rule; a verse may now be soft-deleted or gone.
    await Promise.all([get().fetchVerses(), get().fetchMasteredVerses()]);
  },

  removeSharedMember: async (sharedId, userId) => {
    const { error } = await supabase.rpc('remove_shared_member', { p_shared: sharedId, p_user: userId });
    if (error) throw error;
    await Promise.all([get().fetchSharedCollections(), refetchLoadedProgress(sharedId)]);
  },

  setSharedMemberRole: async (sharedId, userId, role) => {
    const { data, error } = await db.from('shared_collection_members')
      .update({ role })
      .eq('shared_collection_id', sharedId)
      .eq('user_id', userId)
      .select('role');
    if (error) throw error;
    if (data.length !== 1) throw new Error('Only the owner can change roles.');
    await refetchLoadedProgress(sharedId);
  },

  // ============ VERSE ACTIONS ============

  copyVerseToCollection: async (verseId, collectionId) => {
    // A shared collection holds the group's references: the copy adds one, and sync links the verse.
    const sharedId = sharedIdOf(collectionId);
    if (sharedId) {
      const verse = get().verses.find((v) => v.id === verseId);
      if (!verse) throw new Error('Failed to copy verse');
      await addSharedVerse(sharedId, collectionId, verse);
      return;
    }
    const generation = accountGeneration;
    const session = await getCollectionWriteSession(generation);
    if (!session || generation !== accountGeneration) return;
    const { data, error } = await supabase.rpc('copy_verse_to_collection', {
      verse_client_id: verseId,
      collection_client_id: collectionId,
    }).select('added_at,user_verses!inner(*)').single()
      .setHeader('Authorization', `Bearer ${session.access_token}`)
      .overrideTypes<VerseMembershipRow, { merge: false }>();
    if (generation !== accountGeneration) return;
    if (error) throw error;

    const copy = parseVerseMembership(data.user_verses, collectionId, data.added_at);
    set((state) => state.verses.some((v) => v.id === verseId && v.collectionId === collectionId)
      ? state
      : { verses: [copy, ...state.verses] }
    );
  },

  addVerse: async (verse, collectionId) => {
    const sharedId = sharedIdOf(collectionId);
    if (sharedId) return addSharedVerse(sharedId, collectionId, verse);
    const userId = await getCurrentUserId();
    const createdAt = new Date();
    const translation = get().bibleVersion;

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

    // One verse per reference, in any translation, including soft-deleted rows.
    // A held verse is reused; otherwise the best soft-deleted row comes back.
    const { data: rows, error: lookupError } = await supabase
      .from('user_verses')
      .select(`${VERSE_IDENTITY_COLUMNS}, last_practiced_at, last_chunk_size, last_difficulty`)
      .eq('user_id', userId)
      .eq('book', verse.book)
      .eq('chapter', verse.chapter)
      .eq('verse_start', verse.verseStart)
      .eq('verse_end', verse.verseEnd);
    if (lookupError) {
      console.error('[STORE] Failed to look up verse:', lookupError);
      throw new Error('Failed to save verse');
    }
    const records = rows.map(toRecord);
    const existing = records.find(({ deleted }) => !deleted) ?? [...records].sort(compareRecords(translation))[0];

    let verseId: string;
    let clientId: string;
    let version = translation;
    let progress: SavedVerse['progress'] = DEFAULT_PROGRESS;
    const existingRow = existing && rows.find((r) => r.id === existing.id);

    if (existing) {
      verseId = existing.id;
      clientId = existing.clientId;
      progress = existing.progress;
      // A restored verse comes back in the account translation, unless the translation
      // may leave it out or another row of the reference already holds that version.
      if (!existing.deleted || mayBeMissing(existing)
        || records.some((r) => r !== existing && r.version === translation)) {
        version = existing.version as BibleVersion;
      }

      if (existing.deleted) {
        const { error: restoreError } = await supabase
          .from('user_verses')
          .update({ deleted_at: null, version })
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
      ...(existingRow ? parseVerseRowExtras(existingRow) : {}),
    };

    // Adding a verse the collection already holds keeps the one card it has.
    const isThisMembership = (v: SavedVerse) => v.id === clientId && v.collectionId === collectionId;
    set((state) => state.verses.some(isThisMembership)
      ? state
      : { verses: [resultVerse, ...state.verses] });

    return get().verses.find(isThisMembership) ?? resultVerse;
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

    // Shared: the reference leaves the group, and a trigger applies the same rule to every
    // member's copy, this one included (docs/features/shared-collections.md#sync).
    const sharedId = sharedIdOf(collectionId);
    if (sharedId) {
      try {
        if (!verse) throw new Error('Verse not found');
        const { data, error } = await db.from('shared_collection_verses').delete()
          .eq('shared_collection_id', sharedId)
          .eq('book', verse.book)
          .eq('chapter', verse.chapter)
          .eq('verse_start', verse.verseStart)
          .eq('verse_end', verse.verseEnd)
          .select('book');
        if (error) throw error;
        if (data.length === 0) throw new Error('Only the owner and editors can remove verses here.');
        await Promise.all([
          get().fetchVerses(), get().fetchMasteredVerses(), get().fetchSharedCollections(), refetchLoadedProgress(sharedId),
        ]);
        return { wasMastered: isMastered };
      } catch (error) {
        set({ verses: previousVerses });
        throw error;
      }
    }

    // One transaction on the server: the verse leaves, and if no other collection holds it, it is
    // soft-deleted when mastered and deleted otherwise (supabase/migrations/*_delete_verse.sql).
    const { error } = await supabase.rpc('delete_verse', { verse_client_id: id, collection_client_id: collectionId });
    if (error) {
      console.error('[STORE] Failed to delete verse:', error);
      set({ verses: previousVerses });
      throw new Error('Failed to delete verse');
    }
    return { wasMastered: isMastered };
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

    // A shared card's emblem reads `get_shared_status`, so a square that just turned mastered or
    // engraved refetches it.
    const engravedNow = newProgress.engraved?.completed === true && verse.progress.engraved?.completed !== true;
    if ((justBecameMastered || engravedNow) && inSharedCollection(get(), id)) await get().fetchSharedCollections();
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
    // A mastered square went back to Open: the shared card's emblem may no longer hold.
    if (wasMastered && inSharedCollection(get(), id)) await get().fetchSharedCollections();
  },

  setVerseStudyPrefs: (id, chunkSize, difficulty) => {
    // No-op when unchanged: the setup screen saves on every edit and
    // on session start, and a redundant set() would swap the verse's
    // object identity — re-rendering every subscriber (visible as a
    // flicker on the setup screen mid-navigation) for nothing.
    const existing =
      get().verses.find((v) => v.id === id) ??
      get().masteredVerses.find((v) => v.id === id);
    if (!existing || (existing.lastChunkSize === chunkSize && existing.lastDifficulty === difficulty)) {
      return;
    }

    // Optimistic update on every entry for this verse (junction-row
    // shape: a verse in N collections has N entries in `verses[]`).
    // Fire-and-forget preference write — no rollback; a lost write
    // just means the setup screen falls back to defaults next open.
    set((state) => ({
      verses: state.verses.map((v) =>
        v.id === id ? { ...v, lastChunkSize: chunkSize, lastDifficulty: difficulty } : v,
      ),
      masteredVerses: state.masteredVerses.map((v) =>
        v.id === id ? { ...v, lastChunkSize: chunkSize, lastDifficulty: difficulty } : v,
      ),
    }));
    void updateVerseStudyPrefs(id, chunkSize, difficulty);
  },

  // ============ RESET ============

  clear: () => {
    accountGeneration++;
    requestedTranslation = null;
    set({
      collections: [],
      verses: [],
      masteredVerses: [],
      curatedSaverCounts: {},
      sharedCollections: {},
      sharedProgress: {},
      displayName: null,
      firstName: null,
      lastName: null,
      // Device prefs (colorMode, reviewMaxIntervalDays, masteredSort,
      // inProgressSort) and the cached account translation (bibleVersion,
      // replaced from the next account's profile on hydrate) are preserved
      // across sign-out by virtue of being absent from this set call —
      // Zustand keeps unspecified keys. AsyncStorage copies are never touched here.

      hydrated: false,
      collectionsLoading: true,
      collectionOrderSaving: false,
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
export const useCuratedSaverCount = (catalogId: string) => useAppStore((state) => state.curatedSaverCounts[catalogId]);

/**
 * Sort preference for a given collection. Routes by ID literal because
 * virtual-collection objects in `collections` never carry a
 * `sortPreference` field — fetchCollections inserts the
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

/** The shared collection a local collection is a copy of, or undefined for a personal one. */
export function useSharedCollection(collectionId: string): SharedCollectionInfo | undefined {
  return useAppStore((state) => {
    const sharedId = state.collections.find((c) => c.id === collectionId)?.sharedId;
    return sharedId ? state.sharedCollections[sharedId] : undefined;
  });
}

/** The owner's display name for a shared collection (yours when you own it), or null. */
export function useSharedOwnerName(collectionId: string): string | null {
  return useAppStore((state) => {
    const sharedId = state.collections.find((c) => c.id === collectionId)?.sharedId;
    const shared = sharedId ? state.sharedCollections[sharedId] : undefined;
    if (!shared) return null;
    return shared.role === 'owner' ? state.displayName : shared.ownerName;
  });
}

/** Real collections the user may add verses to: personal ones, and shared ones they own or edit. */
export function useAddableCollections() {
  const collections = useAppStore(useShallow((state) => state.collections));
  const shared = useAppStore((state) => state.sharedCollections);
  return useMemo(() => collections.filter((c) => !c.isVirtual
    && (!c.sharedId || canEditShared(shared[c.sharedId]?.role))), [collections, shared]);
}

/**
 * Verses that deleting or leaving this collection would lose: not mastered and in no other
 * collection (the delete rule in docs/features/library.md#deleting-a-verse).
 */
export function useVersesLostWith(collectionId: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(() => {
    const elsewhere = new Set(verses.filter((v) => v.collectionId !== collectionId).map((v) => v.id));
    return verses.filter((v) => v.collectionId === collectionId && !elsewhere.has(v.id) && !v.progress.hard.completed).length;
  }, [verses, collectionId]);
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
  return !v.progress.hard?.completed && hasPracticed(v.progress);
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
    const at = new Date(nowMs);
    for (const v of masteredVerses) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      if (isDueForReview(v, at)) mastered += 1;
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
