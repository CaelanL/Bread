# Review and mastery

How a verse becomes mastered, comes back for review, and gets engraved. All of it is client code over `user_verses.progress`, plus a push digest that reads the result. Scoring is in `docs/features/study-session.md`. Row shape and RLS are in `docs/architecture/data-model.md`.

Read this before touching `lib/store/review.ts`, `lib/store/review-config.ts`, or `updateVerseProgress` in `lib/store/index.ts`.

## Invariant 7

**Mastery progression lives in the Zustand store (`updateVerseProgress` in `lib/store/index.ts`). Nothing else implements streak or engraved logic.** The store action is the single source of truth for "did this session count toward engraved status."

- `computeNextSrState` in `lib/store/review.ts` holds the schedule rules as a pure function. `updateVerseProgress` is its only production caller.
- Other code reads the result: badges, sorts, the due pill, the push digest. None of it writes `progress.engraved`.
- The practice streak on Insights is a separate activity count in SQL. It decides nothing about mastery. See `docs/features/insights.md`.

## What a session writes

`hooks/use-study-session.ts` calls the store action in two places, without awaiting it:

| Session end | Call | Score |
|---|---|---|
| All chunks done | `updateVerseProgress(id, difficulty, score, true)` | `calculateFinalScore` |
| Early exit with at least one chunk done | `updateVerseProgress(id, difficulty, partialScore)`, so `fullSession` is false | `calculatePartialScore`, which counts unfinished chunks as missing words |

Inside the action:

1. `last_practiced_at` is always written.
2. If the score beats `progress[difficulty].bestAccuracy`, that difficulty becomes `{ bestAccuracy: score, completed: score >= 90 }`. A lower score never clears `completed`.
3. If the session is a **qualifying review**, `computeNextSrState` produces the new `progress.engraved`.
4. The row is updated first. Zustand changes only after the write succeeds. On failure the action throws and local state stays as it was.

A verse is **mastered** when `progress.hard.completed` is true. Mastery is permanent until the user resets the verse. A mastered verse joins `masteredVerses` when it first gets there.

## Qualifying review

```ts
difficulty === 'hard' && score >= 90 && fullSession
```

Chunk size doesn't matter. A Hard session split into one-verse chunks qualifies. The setup screen defaults mastered verses to Hard for this reason (`docs/features/study-session.md`). Anything else leaves `progress.engraved` untouched, including `lifetimeReviews`.

## Schedule

`computeNextSrState` has three outcomes for a qualifying review:

| Verse state | `passCount` | `lifetimeReviews` | `lastReviewedAt` | `nextDueAt` |
|---|---|---|---|---|
| `nextDueAt` is null (no schedule yet) | +1 | +1 | now | rescheduled |
| Before `nextDueAt` (locked) | unchanged | +1 | now | unchanged |
| On or after `nextDueAt` | +1 | +1 | now | rescheduled |

Rescheduling is `nextDueAfterDays(now, min(passCount, cap))`. Lateness costs nothing. An overdue review counts the same as an on-time one, and the next interval runs from the day it was completed.

A verse's first qualifying session is usually also the one that masters it, so it counts as pass 1.

Passing every review on its first possible day gives passes on days 0, 1, 3, 6, 10, 15, 21, 28, 36 and 45. Pass 10 lands 45 days after pass 1.

**Local midnight.** `nextDueAfterDays` returns the ISO UTC instant of local midnight, N calendar days after today. A verse is due for its whole local day, so a daily digest at any wall-clock time catches it. A review at 11 PM with a 1-day interval comes due one hour later.

- It moves by `setDate`, so DST days don't shift the result.
- The stored value is a fixed instant. After changing time zones, the verse comes due at midnight of the zone it was reviewed in.
- Hour-precise values from older app versions still compare correctly, and get snapped on their next qualifying review.

## Engraved

Engraved is `passCount >= ENGRAVED_THRESHOLD`, with the threshold set to 10 in `lib/store/review-config.ts`. It is stored as `progress.engraved.completed`.

- It is a milestone, not a state change. The schedule keeps running the same way, and `passCount` keeps growing past 10.
- It is sticky. Missing a review or failing a session never removes it. Only a reset does.
- `computeNextSrState` and `parseEngravedProgress` both keep `completed` once it is true.

## Data shape

`progress.engraved` on `user_verses`. `EngravedProgress` in `lib/storage/index.ts` is the type.

| Field | Meaning |
|---|---|
| `completed` | Engraved, as above |
| `passCount` | Qualifying reviews that advanced the schedule. Not reset by lateness |
| `nextDueAt` | ISO UTC of a local midnight. Null means no schedule yet, and a mastered verse with null is due |
| `lifetimeReviews` | Every qualifying session, early ones included. Not shown in the app |
| `lastReviewedAt` | ISO UTC of the last qualifying session. Written, not read by any screen |
| `months` | Legacy, see below |

`DEFAULT_PROGRESS` in `lib/storage/index.ts` is the one default. Every read goes through `parseProgress`, which fills gaps, so a row with no `engraved` object reads as zeros and nulls.

## Legacy `months`

The old rule was 90% on Hard for 4 consecutive calendar months, stored as `progress.engraved.months`.

**What migration 014 did** (`supabase/migrations/014_review_state.sql`). For each row with an `engraved` object and no `passCount`:

- `passCount` and `lifetimeReviews` seeded from `months.length`, or 10 if the row was already `completed`.
- `nextDueAt` and `lastReviewedAt` set to null, so mastered rows read as due.
- `months` kept. Rows with no `engraved` object were left alone.

**What the client does with it today:**

- `parseEngravedProgress` uses `months.length` only when `passCount` or `lifetimeReviews` isn't a number. That covers a row an old app version overwrote with the legacy shape.
- It carries the array along in memory, and `computeNextSrState` spreads it forward, so each progress write echoes the array back unchanged.
- `DEFAULT_PROGRESS` writes `months: []` on new rows and resets.
- No code adds a month or decides anything else from it.

No migration removes it. Don't build on it.

## Review states

| State | Condition | Verse card (`ReviewStateBadge`) | Setup (`ProgressCard`) |
|---|---|---|---|
| Pre-mastery | `hard.completed` false | No badge | "Engraved Progress", `passCount / 10` |
| Due | Mastered, not engraved, `nextDueAt` null or passed | "Review now" | "Ready to Review", "Review now to advance" |
| Locked | Mastered, not engraved, `nextDueAt` in the future | "Next review tmr", "Next review in 3d" | Lock icon, "Unlocks tomorrow", "Unlocks in 3d" |
| Engraved | `completed` true | No badge; the engraved glyph sits beside the version, where a mastered verse's check goes | "Engraved" and a tagline |

Engraved wins over due. Engraved verses keep coming due, and they count in the due pill, the due-first sort and the push digest. Only the verse row hides it.

`formatTimeUntilDue` in `lib/store/review.ts` is the one label formatter: under 24 hours is `tmr`, 1 to 3 days include hours (`1d 5h`), 4 days and up are `Xd`.

**Where "due" is worked out.** There is no single reader. Change the rule in all of these:

| Where | Used for |
|---|---|
| `isDueForReview`, `daysUntilDue` in `lib/store/review.ts` | Verse card badge (`ReviewStateBadge`), "N due" pill on the Mastered row (`useDueCounts` in `lib/store/index.ts`, through `DueCountPill`), due-first sort (`sortVerses` in `lib/store/library-sort.ts`) |
| `ProgressCard` | Setup screen |
| `loadDueVerses` in `supabase/functions/send-notifications/sources/reviews-digest.ts` | Push digest |

Only Mastered has the pill and the due-first sort, which is its default. The In Progress collection has no schedule. See `docs/features/library.md` and `docs/features/notifications.md`.

**Freshness.** `useReviewNow` in `hooks/use-review-now.ts` returns a `now` that updates on focus and every 60 seconds while focused. Screens with lists pass it down through `ReviewNowProvider`, so one timer drives every badge.

## Interval cap

`reviewMaxIntervalDays` in the store. Default 90, range 10 to 365, from `lib/store/review-config.ts`.

- Set in Settings, REVIEW section, with the wheel picker in `components/settings/ReviewIntervalModal.tsx`. Another row there opens `ProgressInfoModal`, which explains the system.
- `setReviewMaxIntervalDays` clamps to the range and saves to AsyncStorage under `review_max_interval_days`. It is a device preference: not synced, and kept across sign-out because `clear()` leaves it out.
- Only future reviews use a new cap. Existing `nextDueAt` values aren't recomputed.
- `computeNextSrState` treats a corrupt cap (0, NaN, negative) as 1 day, so a verse can't stay due forever.
- The floor of 10 means the cap never shortens or stretches an interval on the way to engraved.

## Delete and reset

Review state lives in the `progress` column, so it follows the row. Delete rules themselves are in `docs/features/library.md`.

| Action | Review state |
|---|---|
| Remove from a collection, verse is in others | Kept |
| Remove from its last collection, mastered | Kept. Row is soft-deleted and stays in Mastered |
| Remove from its last collection, not mastered | Row is hard-deleted. No schedule existed |
| Re-add a soft-deleted verse | Kept. Row is restored with its `progress` and picks up where it was |
| Reset Progress on the setup screen | Wiped to `DEFAULT_PROGRESS`, engraved included, and `last_practiced_at` cleared. The alert says so |

## Tests

`lib/store/__tests__/review.test.ts`, run by `npm test`, covers `nextDueAfterDays` (DST included), `computeNextSrState`, the due helpers and `formatTimeUntilDue`. The store action has no unit test.

## Sharp edges

- **A partial session can master a verse.** The best-score branch of `updateVerseProgress` doesn't check `fullSession`. Leaving a long passage early with a partial score of 90 or more on Hard sets `hard.completed`. The verse enters Mastered as due, with no pass counted. Partial scores set `completed` on Easy and Medium the same way.
- **A failed save behaves differently by path.** A failed full-session write shows a toast. A failed early-exit write only logs to the console. Neither retries. Quitting right after the results appear can lose the write. See `docs/architecture/sync-and-storage.md`.
- **Two devices can drift by one.** Writes are last-write-wins and each device checks its own copy of `nextDueAt`. Two reviews can both count, or one can overwrite the other.
- **The pill and the push can disagree.** `useDueCounts` includes soft-deleted mastered verses. `loadDueVerses` filters `deleted_at` out. The pill can show verses that the digest never mentions.
- **Reset on a soft-deleted mastered verse leaves stale state.** See `docs/features/library.md`.
- **Unused code.** `dueVersesFor` and `lockedVersesFor` have no callers in the app. `dueCount` in `app/(tabs)/(library)/[id].tsx` is computed and never rendered. Don't assume a change to them reaches a screen.

## Browser checks

Seed user reader-a has John 3:16 mastered with `passCount` 1 and no schedule.

- `npm run sim -- shot "/(tabs)/(library)" --as reader-a`: the Mastered row shows "1 due".
- `npm run sim -- shot "/(tabs)/(library)/mastered" --as reader-a`: John 3:16 with a "Review now" badge.
- `npm run sim -- shot "/(tabs)/(library)/setup/seed-john-3-16" --as reader-a`: "Ready to Review", `1 / 10`, "Review now to advance".
- By hand, with a microphone: review John 3:16 on Hard and score 90 or more, then go back. The pill is gone, the badge reads "Next review in 1d" plus hours, and setup shows `2 / 10`. Review again right away: `2 / 10` stays and the lock stays.

## Decisions

- 2026-04-27 · Replace the calendar-month streak with a pass count, engraved at 10 · A month rule breaks on one missed month and says nothing about when a verse is slipping.
- 2026-04-27 · Interval in days equals `passCount` · Simple linear growth, and reaching 10 takes about six weeks at the fastest.
- 2026-04-27 · Early reviews never advance `passCount` · Spacing is the point, so same-day repeats can't count. They still tick `lifetimeReviews`.
- 2026-04-27 · Due is worked out on the client from the loaded verse list · No RPC or index needed. The digest later added its own server-side check because it runs with no client.
- 2026-04-27 · Migration 014 only adds fields, and the client tolerates both shapes · Old and new app versions share one database, and migration timing can't track App Store updates.
- 2026-04-27 · Due-first sort on Mastered, no separate "Review" collection · A third virtual collection would overlap Mastered and blur where to go.
- 2026-04-28 · Engraved is a milestone, with no freeze at the cap · One algorithm before and after engraving.
- 2026-04-28 · Reset wipes review state, engraved included · The user asked to start over.
- 2026-04-28 · A mastered verse with no schedule shows as due · The next qualifying review starts its schedule, which beats showing no badge.
- 2026-04-29 · `nextDueAt` snaps to local midnight · A digest at any chosen time must catch every verse on its due day.
- 2026-06-04 · Lower the cap floor from 30 to 10 · 10 still leaves every interval before engraved unclamped.
- 2026-11-12 · An engraved verse's row shows the engraved glyph beside the version, where a mastered verse's check sits, and no "N reviews" pill · Caelan's pass 4 (C24): the pill under the row was noise once engraved; the reference keeps its tint.
