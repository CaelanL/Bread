// lib-ok: Pure reading of a shared collection's members × references grid from the server's per-square booleans.
import { BIBLE_BOOKS } from '@/lib/bible/books';
import { hasPracticed } from '@/lib/store/review';
import { referenceKey } from '@/lib/store/translation';
import type { SharedCollectionInfo, SharedRole, VerseProgress } from '@/lib/storage';

/** A member's state on one reference. Due and Locked (spaced review) are Mastered. */
export type MemberState = 'open' | 'learning' | 'mastered' | 'engraved';

export interface SharedReference {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

export interface ProgressFlags {
  practiced: boolean;
  mastered: boolean;
  engraved: boolean;
}

/** One row of `get_shared_progress`: a member's square for one reference. */
export interface ProgressCell extends SharedReference, ProgressFlags {
  userId: string;
}

export interface GridRow {
  key: string;
  reference: SharedReference;
  /** One state per member, in `Grid.memberIds` order. */
  states: MemberState[];
  /** Members who mastered it, engraved included. */
  masteredCount: number;
}

export interface Grid {
  memberIds: string[];
  rows: GridRow[];
}

export function cellState(flags: ProgressFlags): MemberState {
  if (flags.engraved) return 'engraved';
  if (flags.mastered) return 'mastered';
  if (flags.practiced) return 'learning';
  return 'open';
}

export function isMasteredState(state: MemberState): boolean {
  return state === 'mastered' || state === 'engraved';
}

/** The same booleans the server folds per square (`private.member_squares`), from one local verse. */
export function progressFlags(progress: VerseProgress): ProgressFlags {
  return {
    practiced: hasPracticed(progress),
    mastered: progress.hard.completed,
    engraved: progress.engraved?.completed === true,
  };
}

/** `cells` with one member's squares swapped for `own` wherever `own` has that reference. */
export function replaceMemberCells(cells: ProgressCell[], userId: string, own: ProgressCell[]): ProgressCell[] {
  const ownKeys = new Set(own.map(referenceKey));
  return [...cells.filter((c) => c.userId !== userId || !ownKeys.has(referenceKey(c))), ...own];
}

/**
 * Every member × every reference. A square with no cell is Open; several cells for one square
 * fold with OR, like the server's `bool_or`. Cells for anyone or anything else are ignored.
 */
export function buildGrid(memberIds: string[], references: SharedReference[], cells: ProgressCell[]): Grid {
  const folded = new Map<string, ProgressFlags>();
  for (const cell of cells) {
    const square = `${cell.userId}|${referenceKey(cell)}`;
    const prior = folded.get(square);
    folded.set(square, {
      practiced: cell.practiced || (prior?.practiced ?? false),
      mastered: cell.mastered || (prior?.mastered ?? false),
      engraved: cell.engraved || (prior?.engraved ?? false),
    });
  }
  const open: ProgressFlags = { practiced: false, mastered: false, engraved: false };
  const rows = references.map((reference) => {
    const key = referenceKey(reference);
    const states = memberIds.map((id) => cellState(folded.get(`${id}|${key}`) ?? open));
    return { key, reference, states, masteredCount: states.filter(isMasteredState).length };
  });
  return { memberIds, rows };
}

/** Mastered (or engraved) squares over all squares, 0 to 1. An empty grid is 0. */
export function groupProgress(grid: Grid): number {
  const squares = grid.memberIds.length * grid.rows.length;
  if (squares === 0) return 0;
  return grid.rows.reduce((sum, row) => sum + row.masteredCount, 0) / squares;
}

function everyone(grid: Grid, test: (state: MemberState) => boolean): (row: GridRow) => boolean {
  return (row) => grid.memberIds.length > 0 && row.states.every(test);
}

/** References every member has mastered. */
export function masteredByEveryoneCount(grid: Grid): number {
  return grid.rows.filter(everyone(grid, isMasteredState)).length;
}

/**
 * Whether anyone besides the owner is in the group. Until someone joins, a shared collection looks
 * and acts like a personal one: no group card, no group counts, personal emblems and delete text.
 */
export function hasOtherMembers(status: Pick<SharedCollectionInfo, 'memberCount'> | undefined): boolean {
  return (status?.memberCount ?? 0) > 1;
}

/** A Library card's emblem: the whole collection mastered (engraved counts) or engraved. */
export type Emblem = 'mastered' | 'engraved';

function emblemOf(states: MemberState[]): Emblem | null {
  if (states.length === 0 || !states.every(isMasteredState)) return null;
  return states.every((s) => s === 'engraved') ? 'engraved' : 'mastered';
}

/** A personal collection's emblem from its verses' progress. None for an empty collection. */
export function soloEmblem(progress: VerseProgress[]): Emblem | null {
  return emblemOf(progress.map((p) => cellState(progressFlags(p))));
}

/** A shared collection's emblem from `get_shared_status`: every member on every reference. */
export function sharedEmblem(
  status: Pick<SharedCollectionInfo, 'memberCount' | 'verseCount' | 'masteredSquares' | 'engravedSquares'>,
): Emblem | null {
  const squares = status.memberCount * status.verseCount;
  if (squares === 0 || status.masteredSquares !== squares) return null;
  return status.engravedSquares === squares ? 'engraved' : 'mastered';
}

/** One Who's where column (and row): a 20 pt tile and a 6 pt gap. Columns never stretch. */
export const GRID_PITCH = 26;

/** The member columns scroll sideways when they're wider than the measured space beside the references. */
export function gridScrolls(memberCount: number, availableWidth: number): boolean {
  return memberCount * GRID_PITCH > availableWidth;
}

export interface GridMember {
  userId: string;
  displayName: string;
  role: SharedRole;
}

export interface GridColumn extends GridMember {
  you: boolean;
  /** One state per row of the Who's where grid, in its row order. */
  states: MemberState[];
  /** Squares mastered, engraved included. */
  masteredCount: number;
}

const BOOK_ORDER: readonly string[] = BIBLE_BOOKS;

function bibleOrder(a: SharedReference, b: SharedReference): number {
  return BOOK_ORDER.indexOf(a.book) - BOOK_ORDER.indexOf(b.book)
    || a.chapter - b.chapter || a.verseStart - b.verseStart || a.verseEnd - b.verseEnd;
}

/**
 * The Who's where grid: references down in Bible order, members across with your column first,
 * then everyone else in `members` order (owner first, then by join). Members missing from the
 * grid get no column.
 */
export function whoIsWhere(grid: Grid, members: GridMember[], youId: string | undefined): { rows: GridRow[]; columns: GridColumn[] } {
  const rows = [...grid.rows].sort((a, b) => bibleOrder(a.reference, b.reference));
  const ordered = [...members.filter((m) => m.userId === youId), ...members.filter((m) => m.userId !== youId)];
  const columns = ordered.flatMap((member) => {
    const index = grid.memberIds.indexOf(member.userId);
    if (index < 0) return [];
    const states = rows.map((row) => row.states[index]);
    return [{ ...member, you: member.userId === youId, states, masteredCount: states.filter(isMasteredState).length }];
  });
  return { rows, columns };
}
