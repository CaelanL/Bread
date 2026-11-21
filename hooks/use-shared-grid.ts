import { useAuth } from '@/lib/auth';
import { buildGrid, progressFlags, replaceMemberCells, type Grid } from '@/lib/shared/progress';
import type { SavedVerse } from '@/lib/storage';
import { useAppStore, type SharedProgress } from '@/lib/store';
import { useMemo } from 'react';

/**
 * A shared collection's members × references grid from the store's last read, with your own
 * squares from your verses in the collection, so they match your cards the moment a session saves.
 * `grid` is null until the first read.
 */
export function useSharedGrid(sharedId: string | undefined, ownVerses: SavedVerse[]): {
  sharedProgress: SharedProgress | undefined;
  grid: Grid | null;
} {
  const { user } = useAuth();
  const sharedProgress = useAppStore((s) => (sharedId ? s.sharedProgress[sharedId] : undefined));
  const grid = useMemo(() => {
    if (!sharedId || !user || !sharedProgress?.fetchedAt) return null;
    const own = ownVerses.map((v) => ({ userId: user.id, book: v.book, chapter: v.chapter,
      verseStart: v.verseStart, verseEnd: v.verseEnd, ...progressFlags(v.progress) }));
    return buildGrid(sharedProgress.members.map((m) => m.userId), sharedProgress.references,
      replaceMemberCells(sharedProgress.cells, user.id, own));
  }, [sharedId, user, sharedProgress, ownVerses]);
  return { sharedProgress, grid };
}
