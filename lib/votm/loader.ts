// lib-ok: Owns monthly request generations so stale month, version or account reads never reach Home.
import { fetchVerse, type BibleVersion } from '@/lib/api/bible';
import { getCurrentVOTM, getVOTMMasteryCount, hasUserMasteredVOTM, localMonthKey, type VOTM } from '@/lib/api/votm';
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

const samePassage = (a: VOTM, b: VOTM | null) => !!b && a.id === b.id && a.book === b.book
  && a.chapter === b.chapter && a.verseStart === b.verseStart && a.verseEnd === b.verseEnd;

export function createMonthlyLoader(publish: (state: MonthlyState) => void) {
  let generation = 0;
  let shown: { state: MonthlyState; version: BibleVersion } | null = null;
  return {
    cancel() { generation++; },
    async load(version: BibleVersion, now = new Date()) {
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
      try {
        const votm = await getCurrentVOTM(now);
        if (request !== generation) return;
        update(votm && samePassage(votm, state.votm)
          ? { votm, textLoading: state.text === null, error: null }
          : { ...EMPTY_MONTHLY_STATE, votm, loading: false, textLoading: !!votm });
        if (!votm) return;
        const book = BIBLE_BOOKS.find((name) => name === normalizeBookName(votm.book));
        if (!book) throw new Error('Unknown monthly book.');
        await Promise.all([
          readCollectionPassage({ ...votm, book }, version, fetchVerse).then(
            (text) => update({ text, textLoading: false }),
            () => update({ text: null, textLoading: false, error: 'Unable to load verse text.' }),
          ),
          Promise.all([getVOTMMasteryCount(votm), hasUserMasteredVOTM(votm)]).then(
            ([masteryCount, userMastered]) => update({ masteryCount, userMastered }),
          ),
        ]);
      } catch {
        update({ ...EMPTY_MONTHLY_STATE, loading: false, error: 'Unable to load this month’s verse.' });
      }
    },
  };
}
