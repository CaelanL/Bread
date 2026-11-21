// lib-ok: Owns monthly request generations so stale month, version or account reads never reach Home.
import { fetchVerse, type BibleVersion } from '@/lib/api/bible';
import { getCurrentVOTM, getVOTMMasteryCount, hasUserMasteredVOTM, localMonthKey, type VOTM } from '@/lib/api/votm';
import { MONTHLY_SCHEDULE } from '@/lib/votm/schedule';
import { readCollectionPassage } from '@/lib/collections/passages';
import { normalizeBookName } from '@/lib/bible';
import { BIBLE_BOOKS } from '@/lib/bible/books';

export interface MonthlyState {
  votm: VOTM | null;
  loading: boolean;
  text: string | null;
  textLoading: boolean;
  masteryCount: number | null;
  userMastered: boolean;
  error: string | null;
}

export const EMPTY_MONTHLY_STATE: MonthlyState = {
  votm: null, loading: true, text: null, textLoading: false,
  masteryCount: null, userMastered: false, error: null,
};

type Passage = Pick<VOTM, 'book' | 'chapter' | 'verseStart' | 'verseEnd'>;

const sameReference = (a: Passage, b: Passage) => a.book === b.book
  && a.chapter === b.chapter && a.verseStart === b.verseStart && a.verseEnd === b.verseEnd;
const samePassage = (a: VOTM, b: VOTM | null) => !!b && a.id === b.id && sameReference(a, b);

/** The passage's text and mastery reads, started together. */
function readPassage(passage: Passage, version: BibleVersion) {
  const book = BIBLE_BOOKS.find((name) => name === normalizeBookName(passage.book));
  const text = book
    ? readCollectionPassage({ ...passage, book }, version, fetchVerse)
    : Promise.reject(new Error('Unknown monthly book.'));
  const mastery = Promise.all([getVOTMMasteryCount(passage), hasUserMasteredVOTM(passage)]);
  // Unused when the month's row names another passage.
  text.catch(() => undefined);
  mastery.catch(() => undefined);
  return { text, mastery };
}

export function createMonthlyLoader(publish: (state: MonthlyState) => void) {
  let generation = 0;
  let shown: { state: MonthlyState; version: BibleVersion } | null = null;
  return {
    cancel() { generation++; },
    /** True once this load's results are on screen without an error. */
    async load(version: BibleVersion, now = new Date()): Promise<boolean> {
      const request = ++generation;
      // A reload of the month and translation on screen (each Home focus, app return, pull to
      // refresh) keeps it there until the new reads land, so the card never drops back to the
      // skeleton and remounts its art. Anything else starts empty.
      const keep = shown && shown.version === version && shown.state.votm?.yearMonth === localMonthKey(now)
        ? shown.state : null;
      let state = keep ?? { ...EMPTY_MONTHLY_STATE };
      const update = (patch: Partial<MonthlyState>) => {
        if (request !== generation) return;
        state = { ...state, ...patch };
        shown = { state, version };
        publish(state);
      };
      if (!keep) update({});
      // The schedule names this month's passage, so its reads start alongside the month's row.
      const scheduled = MONTHLY_SCHEDULE.find((month) => month.yearMonth === localMonthKey(now));
      const early = scheduled ? readPassage(scheduled, version) : null;
      try {
        const votm = await getCurrentVOTM(now);
        if (request !== generation) return false;
        update(votm && samePassage(votm, state.votm)
          ? { votm, textLoading: state.text === null, error: null }
          : { ...EMPTY_MONTHLY_STATE, votm, loading: false, textLoading: !!votm });
        if (!votm) return true;
        if (!BIBLE_BOOKS.some((name) => name === normalizeBookName(votm.book))) throw new Error('Unknown monthly book.');
        // The row names another passage than the schedule: read that one instead.
        const reads = scheduled && early && sameReference(votm, scheduled) ? early : readPassage(votm, version);
        await Promise.all([
          reads.text.then(
            (text) => update({ text, textLoading: false }),
            () => update({ text: null, textLoading: false, error: 'Unable to load verse text.' }),
          ),
          reads.mastery.then(
            ([masteryCount, userMastered]) => update({ masteryCount, userMastered }),
          ),
        ]);
        return request === generation && state.error === null;
      } catch {
        update({ ...EMPTY_MONTHLY_STATE, loading: false, error: 'Unable to load this month’s verse.' });
        return false;
      }
    },
  };
}
