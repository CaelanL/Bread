// lib-ok: when the app and Home reload on return; pure, so it's tested
export const RESUME_AWAY_MS = 30_000;
export const HOME_STALE_MS = 5 * 60_000;

/**
 * Feed it every AppState change: it calls `onResume` when the app is active again after being away
 * (background or inactive, timed from the first) at least RESUME_AWAY_MS. Control Center or a quick
 * app switch isn't a resume.
 */
export function resumeTracker(onResume: () => void, now = Date.now) {
  let awaySince: number | null = null;
  return (state: string) => {
    if (state !== 'active') {
      awaySince ??= now();
      return;
    }
    const away = awaySince;
    awaySince = null;
    if (away !== null && now() - away >= RESUME_AWAY_MS) onResume();
  };
}

/** One of Home's loads: whose (account and translation), when, the last session save then, and the month. */
export interface HomeLoad {
  key: string;
  at: number;
  sessionAt: number | null;
  month: string;
}

/** Home reloads on focus or return only when its last good load is old, another account's or month's, or a session was saved since. */
export function homeStale(last: HomeLoad | null, next: HomeLoad): boolean {
  return !last || last.key !== next.key || last.month !== next.month
    || last.sessionAt !== next.sessionAt || next.at - last.at >= HOME_STALE_MS;
}
