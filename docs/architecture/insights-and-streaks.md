# Insights and Streaks

> **Status: Living document.** Update when an insight is added, when
> a SQL function or cron schedule changes, or when streak logic
> moves. Read before touching `app/(tabs)/insights.tsx`,
> `hooks/use-streak.ts`, `lib/api/analytics.ts`, or analytics-related
> SQL functions.

The Insights screen surfaces the user's activity: streak, time
studied, verses mastered, in progress, and globally popular verse
ranges. Most of the heavy computation happens in Postgres — either
on demand (streak, time studied) or precomputed via cron (user_stats,
popular_ranges).

The Insights tab itself is `href: null` (hidden) — users reach it
from the InsightsCard on the Home tab.

## Data sources

| Insight | Source | Computed where |
|---|---|---|
| Streak (consecutive days) | `session_attempts` | SQL function `get_current_streak`, called on demand |
| Total time studied | `session_attempts.recording_duration_ms` | SQL function `get_total_time_studied` |
| Verses mastered | `user_verses.progress.hard.completed` | Zustand selector `useInsightsStats` |
| Verses in progress | `user_verses.progress` | Zustand selector |
| Average time to master | `user_stats.avg_time_per_word_ms × 23` | Cron-precomputed (every 6 hours), only for users with 600+ mastered words |
| Most popular verse ranges (global) | `popular_ranges` | Cron-precomputed (every 12 hours) |
| Most-memorized books (per user) | `user_verses` | Zustand selector |

## Streak

Function: `get_current_streak(p_user_id UUID, p_tz_offset_min INT)`
(`supabase/migrations/012_analytics_functions.sql.done`).

Logic:

1. Convert all `session_attempts.created_at` to the user's local
   timezone using the offset parameter.
2. Get the distinct dates with at least one attempt.
3. Order desc.
4. If the most recent date is **not** today or yesterday → return 0
   (streak broken).
5. Walk backwards counting consecutive days until a gap.

A streak day = at least one `session_attempts` row of any
difficulty, any verse, any score. It's not "completed today" — it's
"practiced today."

Client hook: `useStreak()` in `hooks/use-streak.ts`. It calls the
RPC with `new Date().getTimezoneOffset()` so the calculation
matches the user's local day.

## Time studied

Function: `get_total_time_studied(p_user_id UUID)` (migration 012).

```sql
SELECT COALESCE(SUM(recording_duration_ms), 0)::BIGINT
FROM session_attempts
WHERE user_id = p_user_id;
```

Includes every attempt — partial early-exit attempts as well as
complete sessions. Returns milliseconds; client converts to a
human-readable string (e.g. "2h 14m").

`recording_duration_ms` is nullable; old rows may not have it. The
SUM treats NULLs as zero.

## Verses mastered / in progress

Computed client-side from the Zustand store —
`useInsightsStats()` selector in `lib/store/index.ts`.

```ts
versesMastered = unique verses where progress.hard.completed === true
versesInProgress = unique verses where any progress.bestAccuracy is non-null
                   AND progress.hard.completed === false
```

The dedup is by verse `id`, because a verse can be in multiple
collections. Soft-deleted mastered verses count toward
`versesMastered` (mastery is permanent).

## Average time to master

Source: `user_stats.avg_time_per_word_ms`. Multiplied by 23 (the
target word count for "one verse") in `getAvgTimeToMaster`
(`lib/api/analytics.ts`).

The cron `update_user_stats()` runs every 6 hours
(migration 011) and:

1. Skips users with fewer than 600 words mastered (the metric is
   noisy below that).
2. For each qualifying user, looks at every mastered verse:
   - Find the first attempt that hit ≥90% on Hard.
   - Sum `recording_duration_ms` of all attempts up to and
     including that mastery attempt.
   - Divide by `word_count` for that verse → ms per word.
3. Average across all mastered verses → `avg_time_per_word_ms`.

Returns `null` for users below the threshold. The UI shows "—" in
that case.

## Most popular verse ranges

Function: `update_popular_ranges()` (migration 010), runs every
12 hours.

Generates **every sub-range** of every active or soft-deleted user
verse:

```sql
INSERT INTO popular_ranges (book, chapter, verse_start, verse_end, user_count)
SELECT book, chapter, s, e, COUNT(DISTINCT user_id)
FROM user_verses,
     LATERAL generate_series(verse_start, verse_end) AS s,
     LATERAL generate_series(verse_start, verse_end) AS e
WHERE e >= s
GROUP BY book, chapter, s, e
ORDER BY COUNT(DISTINCT user_id) DESC
LIMIT 1000;
```

So if any user has John 3:1-16, that contributes a row for
3:1, 3:1-2, 3:1-3, ..., 3:1-16, 3:2, 3:2-3, etc.

Public-readable. Service-role only writes. Top 1000 retained.

The Insights tab "Popular Verses" section reads the top 10 (with
`user_count`) and shows them as tappable rows that open a verse
preview + add-to-collection flow.

## Most-memorized books (per user)

Selector: `useMostMemorizedBooks()` in the store. Iterates the
user's `masteredVerses`, groups by `book`, returns the top 5 by
count. Fully client-side — no SQL.

## Logging session attempts

`logSessionAttempt(...)` in `lib/api/analytics.ts`. Inserts one
row per session completion (or partial early exit) with:

```ts
{
  book, chapter, verse_start, verse_end, version,
  difficulty, chunk_size, accuracy, recording_duration_ms, word_count
}
```

User ID comes from `ensureAuth()`. Fire-and-forget — no error
toast on failure (this is one of the known sharp edges; see below).

## Insights screen layout

`app/(tabs)/insights.tsx`:

- Stat cards: Day streak, Total time studied, Verses mastered,
  Verses in progress, Average time to master.
- Popular Verses section: top 10 from `popular_ranges`.
- Most-memorized books: top 5 from selector.

The InsightsCard on Home (`components/home/InsightsCard.tsx`) is a
slim version showing day streak + a couple of counts as a shortcut
to the full tab.

## Invariants

1. **Streak is in any-difficulty `session_attempts`, not
   "completed today."** A practice attempt counts even if the score
   was low. Don't change this without product input — users build
   streaks by showing up, not by succeeding.
2. **`session_attempts` is append-only** (RLS allows INSERT/SELECT
   only). Don't try to UPDATE or DELETE attempts as a "fix."
3. **Mastered count comes from `progress.hard.completed`** in the
   Zustand store, not from a SQL aggregate. The store is the
   source of truth at runtime.
4. **`avg_time_per_word_ms` only exists for users with ≥600 mastered
   words.** UI must handle null.
5. **`popular_ranges` is global and includes soft-deleted verses
   on purpose** — see migration 010 comment.
6. **Streak uses the user's local timezone offset.** Don't query
   `created_at` directly without applying the offset; you'll
   miscount around midnight.

## Sharp edges

- **`logSessionAttempt` is fire-and-forget.** Network failure =
  silently lost analytics. No queue, no toast. Streaks and time
  studied undercount when offline. Worth fixing but currently
  intentional.
- **Streak edge case**: DST transitions and timezone changes can
  in theory miscount around the boundary day. The function uses
  `tz_offset_min` so it's correct at the moment of the call, but
  if a user travels and offset changes, history may shift.
- **Popular ranges are 12 hours stale.** A spike in adoption of
  John 3:16 won't show up until the next cron tick.
- **Soft-deleted verses still inflate popular ranges** until the
  next cron rebuild.
- **`avg_time_per_word_ms` is hard-coded to multiply by 23 for the
  "average time to master a verse" display.** If your average
  verse word count differs significantly from 23, the displayed
  number is misleading.
- **No back-fill of `word_count`.** Old `session_attempts` rows
  have null `word_count` and are excluded from the user_stats
  computation.
