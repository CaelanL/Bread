# Insights

The Insights screen shows the user's activity and the verses most people have mastered. Some numbers come from the store, some from SQL on demand, and two from tables that cron rebuilds.

The screen is `app/(tabs)/(home)/insights.tsx`, pushed on the Home tab's stack from `InsightsCard` on Home (`docs/features/home.md`). Engraved and review rules are in `docs/features/review.md`. Table shapes are in `docs/architecture/data-model.md`.

## Screen and sources

Top to bottom:

| Section | Source | Computed |
|---|---|---|
| Verses Mastered | `useInsightsStats` | Store: `masteredVerses.length` |
| Verses In Progress | `useInsightsStats` | Store: `isInProgressVerse` predicate, deduped by verse id |
| Practice Streak | `useStreak`, `getCurrentStreak` | SQL on demand: `get_current_streak` |
| Time Studied | `getTotalTimeStudied` | SQL on demand: `get_total_time_studied` |
| Time to Master Verse | `getAvgTimeToMaster` | `user_stats`, rebuilt every 6 hours |
| Your Most Memorized Books | `useMostMemorizedBooks` | Store: top 5 books over `masteredVerses` |
| Popular Verses | `getPopularRanges(10)` | `popular_ranges`, rebuilt every 12 hours |

`lib/api/analytics.ts` and `lib/api/popular-verses.ts` hold the API calls. Time stats and popular ranges load when the screen mounts and on pull to refresh.

## Mastered and in progress

Mastered counts `masteredVerses`, which is fetched with no `deleted_at` filter. Soft-deleted verses still count, because mastery is permanent. A verse mastered in two translations is listed and counted once (`onePerReference`). What masters a verse is in `docs/features/review.md`.

In progress uses the same `isInProgressVerse` predicate as `useInProgressVerses`, so this number always equals the In Progress collection in the Library. The push source `loadInProgressVerses` mirrors it on the server. Change them together.

## Streak

`get_current_streak(p_user_id, p_tz_offset_min)` in `supabase/migrations/012_analytics_functions.sql`:

1. Shifts every `session_attempts.created_at` by the offset from the client's `getTimezoneOffset()`.
2. Takes the distinct local dates, newest first.
3. Returns 0 if the newest date is neither today nor yesterday.
4. Counts back through consecutive days until a gap.

A streak day is any logged attempt: any difficulty, any verse, any score, full or partial.

## Time studied

`get_total_time_studied` sums `session_attempts.recording_duration_ms`, treating nulls as nothing. It includes partial attempts. `formatTimeStudied` shows `Xh Ym` under 100 hours and `X.Xh` above.

## Time to master a verse

`getAvgTimeToMaster` reads `user_stats.avg_time_per_word_ms` and multiplies by 23, the word count taken as one verse. With no value it returns null and the card shows `--`.

The `update-user-stats` cron job runs `update_user_stats()` at `0 */6 * * *` (`supabase/migrations/011_user_stats_cron.sql`). It works only from `session_attempts`:

- **`total_words_mastered`:** the sum of `word_count` over each verse's first Hard attempt at 90 or more, per range. A verse mastered in two translations counts once, since a verse follows the account translation (`docs/architecture/bible-versions.md`). Test: `supabase/tests/account-translation.test.sql`.
- **`avg_time_per_word_ms`:** for each of those verses, all recording time up to that attempt, in any version, divided by `word_count`, then averaged. Attempts with a null `word_count` don't count.
- **The threshold:** the average is written only when `total_words_mastered` reaches `stats_min_words` in `app_config`, default 600. Below that it is too noisy.

## Popular Verses

`popular_ranges` is a global table anyone can read. Only `update_popular_ranges()` fills it.

- **Mastered only.** Migration 015 (`supabase/migrations/015_popular_verses_mastered_only.sql`) redefined the function to count rows where `progress.hard.completed` is true.
- **Soft-deleted but mastered verses count.** The query has no `deleted_at` filter, on purpose.
- **Refresh every 12 hours.** The `update-popular-ranges` cron job runs at `0 */12 * * *` (`supabase/migrations/0101_popular_verses.sql`). Each run truncates and rebuilds.
- **Lag.** The table can trail reality by up to 12 hours. A newly mastered verse doesn't appear until the next pass. A reset verse keeps its contribution until then.
- **Sub-ranges.** Each mastered row adds to every sub-range. Mastering John 3:1-16 counts toward 3:1, 3:1-2, and so on through 3:16. Each user adds at most 1 per range.
- **Any version.** Rows group by book, chapter and verse range, so versions combine.
- **Top 1000 kept, top 10 shown.** The section is hidden when the table is empty.

Tapping a row opens `VerseExpandModal` with the text in the user's current version, fetched by `getVerseText`. Its add button opens `AddToCollectionModal`, and it is hidden if the user already has that exact range in any version.

## Logging attempts

`logSessionAttempt` in `lib/api/analytics.ts` inserts one `session_attempts` row. `hooks/use-study-session.ts` calls it when a session finishes, and on early exit if at least one chunk is done. Leaving with no chunk done logs nothing.

## Rules

1. **A streak day means practiced, not passed.** Any attempt counts. Don't change this without a product decision.
2. **`session_attempts` is append-only for clients.** RLS allows SELECT and INSERT only. Don't try to fix data with an update. Rows stay after a verse is deleted, and only `delete_own_account()` removes them.
3. **The mastered count comes from the store,** not a SQL aggregate.
4. **`avg_time_per_word_ms` can be null.** The UI must handle it.
5. **`popular_ranges` is global and counts soft-deleted mastered verses on purpose.**
6. **Streak dates need the client's offset.** Don't query `created_at` for local days without it.

## Sharp edges

- **Attempts are lost silently when offline.** `logSessionAttempt` only logs errors to the console. There is no queue, retry or toast, so streak and time studied undercount.
- **The streak can go stale on screen.** `useStreak` fetches on mount. `InsightsCard` refreshes it on Home's pull to refresh, but pull to refresh on Insights reloads only time stats and ranges, never the streak. Neither screen refetches on focus, so a finished session isn't reflected until one of those happens.
- **The offset applies to all history.** `get_current_streak` shifts every attempt by today's offset. After a DST change or travel, an attempt near midnight can move to another date and change the count.
- **Two meanings of "mastered".** The Mastered card reads `progress`. `user_stats` reads attempts, including partial ones, and a reset doesn't undo them. Stats can count a verse the card no longer does.
- **23 words is a fixed guess.** The figure misleads for someone memorizing much longer or shorter passages.
- **Popular Verses can look repetitive.** Sub-ranges of one long passage fill rows, and ties have no set order, because both the cron query and `getPopularRanges` sort only by `user_count`.
- **Stats functions are open too wide.** `get_current_streak` and `get_total_time_studied` accept any user's id. Clients can also run `update_popular_ranges()` and `update_user_stats()`. `supabase/tests/access.test.sql` tracks both as known bugs.

## Browser checks

Run these on a freshly reset local database. Seed attempts are dated from the reset, so the streak falls to 0 two days later.

- `npm run sim -- shot /insights --as reader-a`: 1 mastered, 1 in progress, "5 days", Time Studied "4m", Time to Master `--`, John (1) under books. Popular Verses is hidden, since the seed adds no ranges.
- `npm run sim -- shot /insights --as reader-b`: 0 and 0, "0 days" with "Start practicing to build your streak!", and "No verses memorized yet".
- By hand: on Home tap the insights card, and the Insights screen opens. Tap the info icon on Time to Master Verse and the formula modal shows "× 23".

## Decisions

- 2026-01-01 · Show time to master only from 600 mastered words · The average is noisy below that.
- 2026-01-16 · Streak and time studied run as SQL functions · The client doesn't have to fetch every attempt.
- 2026-04-28 · `popular_ranges` counts mastered verses only, soft-deleted included · "Popular" means memorized, not just added, and mastery is permanent.
- 2026-11-11 · Words mastered group by reference, not version · A verse follows the account translation, so attempts in two versions are one verse.
