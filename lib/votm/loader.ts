// lib-ok: Owns monthly request generations so stale month, version or account reads never reach Home.
import { fetchVerse, type BibleVersion } from '@/lib/api/bible';
import { getCurrentVOTM, getVOTMMasteryCount, hasUserMasteredVOTM, type VOTM } from '@/lib/api/votm';
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

export function createMonthlyLoader(publish: (state: MonthlyState) => void) {
  let generation = 0;
  return {
    cancel() { generation++; },
    async load(version: BibleVersion, now = new Date()) {
      const request = ++generation;
      let state = { ...EMPTY_MONTHLY_STATE };
      const update = (patch: Partial<MonthlyState>) => {
        if (request !== generation) return;
        state = { ...state, ...patch };
        publish(state);
      };
      update({});
      try {
        const votm = await getCurrentVOTM(now);
        if (request !== generation) return;
        update({ votm, loading: false, textLoading: !!votm });
        if (!votm) return;
        const book = BIBLE_BOOKS.find((name) => name === normalizeBookName(votm.book));
        if (!book) throw new Error('Unknown monthly book.');
        await Promise.all([
          readCollectionPassage({ ...votm, book }, version, fetchVerse).then(
            (text) => update({ text, textLoading: false }),
            () => update({ textLoading: false, error: 'Unable to load verse text.' }),
          ),
          Promise.all([getVOTMMasteryCount(votm), hasUserMasteredVOTM(votm)]).then(
            ([masteryCount, userMastered]) => update({ masteryCount, userMastered }),
          ),
        ]);
      } catch {
        update({ loading: false, textLoading: false, error: 'Unable to load this month’s verse.' });
      }
    },
  };
}
