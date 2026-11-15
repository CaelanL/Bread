// lib-ok: the allowlisted library snapshot, the only place library data reaches disk
import type { Collection, SavedVerse, SharedCollectionInfo } from '@/lib/storage';

/** A snapshot older than this isn't painted (an app rolled back over the air may not read it right). */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION = 1;

export const snapshotKey = (userId: string) => `library_snapshot:${userId}`;

export interface SnapshotData {
  collections: Collection[];
  verses: SavedVerse[];
  masteredVerses: SavedVerse[];
  sharedCollections: Record<string, SharedCollectionInfo>;
  names: { displayName: string | null; firstName: string | null; lastName: string | null };
}

// Field by field, so nothing new reaches disk without being named here. Never `text` or `verses`
// (invariant 2: licensed verse text stays off the device).
function pickVerse(v: SavedVerse): SavedVerse {
  return {
    id: v.id,
    collectionId: v.collectionId,
    book: v.book,
    chapter: v.chapter,
    verseStart: v.verseStart,
    verseEnd: v.verseEnd,
    version: v.version,
    createdAt: v.createdAt,
    progress: v.progress,
    lastPracticedAt: v.lastPracticedAt,
    lastChunkSize: v.lastChunkSize,
    lastDifficulty: v.lastDifficulty,
    updatedAt: v.updatedAt,
  };
}

function pickCollection(c: Collection): Collection {
  return {
    id: c.id,
    name: c.name,
    isDefault: c.isDefault,
    iconKey: c.iconKey,
    createdAt: c.createdAt,
    sortPreference: c.sortPreference,
    sharedId: c.sharedId,
  };
}

function pickShared(g: SharedCollectionInfo): SharedCollectionInfo {
  return {
    id: g.id,
    ownerName: g.ownerName,
    name: g.name,
    role: g.role,
    memberCount: g.memberCount,
    verseCount: g.verseCount,
    masteredSquares: g.masteredSquares,
    engravedSquares: g.engravedSquares,
  };
}

function pick(data: SnapshotData): SnapshotData {
  return {
    // Mastered and In Progress are constants, added back by the store.
    collections: data.collections.filter((c) => !c.isVirtual).map(pickCollection),
    verses: data.verses.map(pickVerse),
    masteredVerses: data.masteredVerses.map(pickVerse),
    sharedCollections: Object.fromEntries(Object.values(data.sharedCollections).map((g) => [g.id, pickShared(g)])),
    names: { displayName: data.names.displayName, firstName: data.names.firstName, lastName: data.names.lastName },
  };
}

export function serializeSnapshot(
  state: Omit<SnapshotData, 'names'> & SnapshotData['names'],
  savedAt: number,
): string {
  const { displayName, firstName, lastName } = state;
  return JSON.stringify({ v: VERSION, savedAt, ...pick({ ...state, names: { displayName, firstName, lastName } }) });
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isVerse = (v: unknown) => isObject(v) && typeof v.id === 'string' && typeof v.collectionId === 'string'
  && typeof v.book === 'string' && typeof v.chapter === 'number' && typeof v.verseStart === 'number'
  && typeof v.verseEnd === 'number' && typeof v.version === 'string' && isObject(v.progress);
const isCollection = (c: unknown) => isObject(c) && typeof c.id === 'string' && typeof c.name === 'string';
const isShared = (g: unknown) => isObject(g) && typeof g.id === 'string' && typeof g.role === 'string';

/** The snapshot's data, or null when it's missing, another format, older than `SNAPSHOT_MAX_AGE_MS` or malformed. */
export function parseSnapshot(raw: string | null, now: number): SnapshotData | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || value.v !== VERSION || typeof value.savedAt !== 'number') return null;
  if (now - value.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
  const { collections, verses, masteredVerses, sharedCollections, names } = value;
  if (!Array.isArray(collections) || !collections.every(isCollection)) return null;
  if (!Array.isArray(verses) || !verses.every(isVerse)) return null;
  if (!Array.isArray(masteredVerses) || !masteredVerses.every(isVerse)) return null;
  if (!isObject(sharedCollections) || !Object.values(sharedCollections).every(isShared)) return null;
  if (!isObject(names)) return null;
  const name = (field: unknown) => (typeof field === 'string' ? field : null);
  return pick({
    collections,
    verses,
    masteredVerses,
    sharedCollections: sharedCollections as Record<string, SharedCollectionInfo>,
    names: { displayName: name(names.displayName), firstName: name(names.firstName), lastName: name(names.lastName) },
  });
}
