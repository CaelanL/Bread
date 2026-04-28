# Feature: Review System (Spaced Repetition)

> **Status:** `building`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Shipped:** —
>
> **Sibling docs:**
> - `docs/features/library-sort-persistence.md` — built **after**
>   this feature ships. The `due-first` sort option in Chunk 4 uses
>   local `useState` (matches the existing sort cycle pattern in
>   `[id].tsx`). When sort-persistence ships next, it makes
>   `due-first` durable along with the other sort options. The two
>   features are independent and ship sequentially.
> - `docs/features/notification-system.md` — stub. Notifications
>   layer that consumes this system; planned in a separate round
>   after review system ships.
>
> **Known transient UX gap (resolved by sort-persistence later):**
> the `due-first` sort introduced in Chunk 4 below resets to the
> collection's default sort (Recent) every time the user navigates
> away — same as the other sort options today. Sort-persistence
> ships next and fixes this for all sort options globally.
>
> **Spike branch:** `ui-spike-review-system` on origin contains the
> visual scaffolding (DueCountPill, ReviewStateBadge, reworked
> ProgressCard) with hardcoded fakes. Use as visual reference when
> implementing Chunks 3–4.

## Problem

Today the app is good at *learning* a verse and bad at *retaining*
it. Once a verse is mastered (90% on Hard) it sits in the Mastered
collection forever and the user has to remember to come back. The
current "engraved" mechanic — 90% on Hard for 4 consecutive months —
tries to nudge ongoing practice, but in production it has zero
completions.

A query of all users (Apr 27 2026) shows:

- **0 fully engraved verses** across the entire user base
- **12 users with any engraving progress**
- **Max 2 months on any single verse** (one user, garcia.jmie, 11
  verses each at 2/4)
- Everyone else: max 1 month on any verse

The calendar-month framing is the wrong unit — it lets months elapse
between nudges, breaks easily on a single missed month, and gives no
signal of *when* a verse is actually slipping. Separately, the user
has no in-app surface that says "this verse is due right now."
Verses get abandoned silently.

This feature replaces the calendar-streak engraving with a
spaced-repetition (SR) review system: each mastered verse carries a
schedule, comes due on a known cadence, and the user can see at a
glance which verses need attention.

## Solution

Each verse the user has reached 90% on Hard for at least once enters
an SR schedule. Days to next review = current pass count
(linear, Bible-Memory-style: 1, 2, 3, 4, …, capped). Each successful
review (full session ending ≥ 90% on Hard, on or after the due date)
advances the count by 1 and reschedules from the completion date.

The "engraved" milestone is redefined as **N successful reviews**
(proposed N=10) — no calendar months, no consecutive streaks. Once
engraved, reviews keep coming at the user-configured maximum
maintenance cadence; engraved status itself is permanent.

Failure / lateness is not punished — the schedule simply resumes
from completion. **Early review (before due date) is not credited**
— the verse is locked from earning a count, but the user can still
practice for fun (and it ticks a separate cosmetic lifetime-review
counter).

Verse cards gain a small badge (Locked / Due / Engraved). The
Library list adds an "In Progress" virtual collection alongside
Mastered and shows a "N due" pill on both. The Mastered and In
Progress collection-detail screens pin a "Review now (N)" header
section above their normal list.

## Notification readiness (deferred to sibling doc)

Notifications are a separate feature
(`docs/features/notification-system.md`). For this doc we only do
what's needed to *not box notifications into a corner*:

- `nextDueAt` is stored as an ISO timestamp on each verse, queryable
  client-side from the in-memory verse list with no extra joins.
- `nextDueAt` is **midnight-aligned** (local) so a "due" verse is due
  for the entire calendar day, not at a specific hour. This makes
  "what's due today" a deterministic per-day question — the right
  shape for a daily-digest notification or for a "review now" badge
  that doesn't flicker mid-day.
- The Library deep-link target is determined by the review system,
  not the notification system: the route is
  `/(tabs)/(library)?reviewView=true`. Notifications will use this
  later; the param is a no-op until then.

Beyond this, all notification UX (when to ask permission, digest vs
per-verse, copy templates, settings toggles, deep-link handler
wiring) belongs to the sibling doc and **will not be implemented in
this feature**.

## Requirements

### Must have

- [ ] Each verse with `progress.hard.completed === true` carries SR
      state: `passCount`, `nextDueAt`, `lastReviewedAt`,
      `lifetimeReviews`, `completed` (engraved boolean).
- [ ] Days-to-next-review = `min(passCount, userMaxIntervalDays)`,
      counted from local midnight of the completion day.
- [ ] A successful review (final session score ≥ 90% on Hard, on or
      after `nextDueAt`) advances `passCount` by 1, increments
      `lifetimeReviews`, and reschedules `nextDueAt` to local
      midnight + N days.
- [ ] An attempt that finishes a full session ≥ 90% on Hard *before*
      `nextDueAt` does **not** advance `passCount` and does not
      reschedule. It does increment `lifetimeReviews` (cosmetic).
- [ ] A session that doesn't qualify (< 90%, or non-Hard difficulty,
      or partial early-exit) does not affect SR state at all
      (passCount, lifetimeReviews, schedule all unchanged).
- [ ] Engraved is `passCount >= ENGRAVED_THRESHOLD` (proposed 10).
      Permanent — does not require ongoing maintenance to retain
      status.
- [ ] Existing users' `progress.engraved.months` data is migrated
      lossless on deployment — `passCount` seeded from
      `months.length`, `lifetimeReviews` seeded the same, `nextDueAt`
      seeded null (next review begins fresh).
- [ ] User-settable max interval cap (range **30 to 365 days**,
      default 90). Stored client-side (AsyncStorage). Existing
      schedules are not retroactively recomputed when the user
      changes the cap; the new cap takes effect on the next
      successful review.
- [ ] New "In Progress" virtual collection (mirrors the Mastered
      virtual-collection pattern): any verse with non-null
      `bestAccuracy` on any difficulty AND `!hard.completed`,
      deduped by verse id. Lenient — matches existing
      `useInsightsStats` exactly so the two counts stay equal.
- [ ] Verse card shows a state badge: Locked (next review in N
      days) / Due (review now) / Engraved (lifetime: N reviews).
- [ ] Library list shows a "N due" pill on the **Mastered** row
      when applicable. (In Progress row gets no pill — In Progress
      verses have no SR schedule.)
- [ ] Mastered + In Progress collection-detail views pin a "Review
      now (N)" header section above the standard list when there
      are due verses.
- [ ] "How does this work?" info modal accessible from Settings
      describing the system in 2–3 sentences.

### Nice to have

- [ ] Visual staleness hint on Engraved verses ("last reviewed 4
      months ago") — never demotes, just informs.
- [ ] "Review all due" entry point from the Library Mastered or
      In Progress detail — single tap kicks off a session queue
      that runs through every due verse one after the other.
- [ ] Subtle pulse / breathing animation on Due-state badges so the
      eye picks them up.
- [ ] Sort options inside Mastered include "Due first" by default
      when any verses are due.

### Explicitly out of scope

- **All notification work.** Permission ask, scheduling, settings
  toggles, deep-link handling, copy templates → sibling doc.
- Demotion semantics. Failing a review never un-engraves, never
  un-masters a verse. Mastery and engraving are permanent once
  earned.
- Spaced-repetition for verses the user hasn't yet mastered. SR
  starts on first 90%-Hard pass; pre-mastery learning is unscheduled.
- Per-verse customization of the review cadence — global cap only.
- Backfilling SR state from `session_attempts` history — we seed
  from `engraved.months.length`, not from prior attempt timestamps.
  (Cohort is small and max-months is 2; backfill complexity is not
  worth it.)
- LLM-generated copy for the info modal or anywhere else.
- Server-side computation of "what's due" — entirely client-side
  off the in-memory verse list.
- Android / web parity. iOS-only feature; settings cap slider is
  rendered everywhere but only meaningful when paired with
  notifications later.

## Open Questions

All questions resolved. UI questions (Q3, Q4, Q9) settled by the
on-device spike (`ui-spike-review-system` branch).

### Q1: Engraved threshold — what is N? *(RESOLVED — N=10)*

`passCount >= N` makes a verse engraved. With linear-day intervals
(1, 2, 3, 4… days), the *fastest* path to engraved is the triangular
sum of N: N=10 → 55 days, N=12 → 78 days, N=15 → 120 days, N=8 → 36
days.

**Resolved: A — N=10.** Matches the user-validated "about 2 months
at fastest" feeling; clean number for UI ("3 of 10 to engrave"). All
algorithm and copy in this doc assume `ENGRAVED_THRESHOLD = 10`.

### Q2: Default max-cap for review interval *(RESOLVED — 90 days, settings configurable 30–365)*

Default determines the post-engravement cadence the average user
gets without touching settings.

**Resolved: A — default 90 days.** Settings exposes a horizontal
slider with range **30–365 days**, default 90. Min was raised from
14 to 30 because intervals below 30 interfere with the early SR
ladder (days 1–10 are required for engraving regardless of cap).

Constants:

```ts
DEFAULT_MAX_INTERVAL_DAYS = 90
MIN_USER_MAX_INTERVAL_DAYS = 30
MAX_USER_MAX_INTERVAL_DAYS = 365
```

**Engraving is decoupled from the cap.** Engraving is only a UI
milestone (passCount ≥ 10). The schedule keeps growing
monotonically (`intervalDays = min(passCount, userMaxIntervalDays)`)
both before and after engraving. There is **no** "freeze at cap once
engraved" behavior. See Q3-engraving-relationship in the algorithm
section below.

### Q3: Badge component shape *(RESOLVED — unified `ReviewStateBadge`)*

**Resolved: A — one unified `ReviewStateBadge` component** with
states `none | locked | due | engraved`. The badge renders inside
the verse card body (a row below the preview text). Replaces direct
`EngravedIcon` use in `SwipeableVerseCard`. Internally the engraved
variant still uses `EngravedIcon` + lifetime-count text. Spike
validated this layout fits the existing card without crowding.

### Q4: Where does the per-collection "due" count live? *(RESOLVED — pill on collection row, top-right)*

**Resolved: A — `DueCountPill` in the collection card's right side**,
between the existing `verseCount` subtitle and the chevron. Hidden
when count is zero. Spike confirmed there's adequate horizontal
space without overflow on the existing card layout.

No tab-bar-icon badge in v1 (Q4 Option B). Tab-icon badges become
relevant once notifications ship; revisit there if needed.

### Q5: Midnight alignment — UTC or user-local? *(RESOLVED — UTC stored, local-display)*

**Resolved**: `nextDueAt` is stored as a UTC ISO timestamp in the
database. The *value* of that timestamp is computed at write time
as the moment the verse becomes due in the user's local timezone
(i.e. the user's local midnight of `[completion_date + N days]`,
converted to UTC). On read:

- "Is this verse due now?" → `Date.now() >= new Date(nextDueAt).getTime()`
  (pure UTC comparison; correct in any timezone).
- "How many days until due?" → compute local-day delta between
  `new Date()` and `new Date(nextDueAt)` using the device's
  current timezone offset.

Effect: a user who reviews on Monday at 11pm PT gets `nextDueAt =
Tuesday-midnight-PT-as-UTC`. That timestamp evaluates as "due" any
time on Tuesday in PT, regardless of when they open the app that
day. If they fly to ET overnight, the timestamp still evaluates
as due — just becomes due 3 hours earlier in ET local time, which
is fine.

### Q6: What counts as a "successful review"? *(RESOLVED — full session only, ≥ 90% on Hard)*

**Resolved: A — full session only.** Matches the existing mastery
rule (per `docs/architecture/study-session.md` step 8: *"Mastery
progression does not update on partial sessions — only full
completions count."*). SR inherits this. Practically a partial
session can't hit ≥ 90% anyway because incomplete chunks are scored
as fully missing words.

### Q7: Migration / cross-version safety *(RESOLVED — client-side tolerance, no timing dependency)*

**Resolved**: we don't try to time the migration push to the App
Store rollout because we can't predict when individual users will
update their app. Instead the safety lives entirely in the **new
client's read path**:

- **Migration 014 is additive and safe to run anytime.** It adds
  `passCount`, `lifetimeReviews`, `nextDueAt`, `lastReviewedAt`. It
  does NOT remove the legacy `months` field.
- **New client tolerates both shapes**: when reading a row, if
  `passCount` is missing but `months` exists, derive
  `passCount := months.length` and `lifetimeReviews := months.length`
  in memory. If the new fields exist, use them directly.
- **New client writes only the new fields.** Doesn't touch `months`.
- **Old clients (still on prior code) are not our problem to fix
  during the rollout window.** They keep running their existing
  code path against the migrated DB. They write `months`; new
  clients re-derive `passCount` from `months.length` on next read
  if needed.
- **Cleanup migration to drop `months`** ships whenever you feel
  confident every active user has updated. No hard deadline.

See "Deployment sequencing" below for the (much shorter) playbook.

### Q8: Should `lifetimeReviews` count *all* practice or only Hard? *(RESOLVED — Hard only, ≥ 90%)*

**Resolved: A — only successful Hard sessions count.** Keeps the
meaning of "review" tied to the SR system. Easy and Medium practice
don't count toward this number even if scored highly.

**Specifically**: `lifetimeReviews` increments only when the
session is qualifying (Hard, ≥ 90%, full-session) — both for
on-time/overdue reviews (where `passCount` also increments) and
for early/locked qualifying reviews (where `passCount` does NOT
increment). It does **not** increment on failed Hard sessions
(< 90%) or on non-Hard sessions, even if those sessions are full
completions.

### Q9: Where does the due-verse surface live inside Mastered? *(RESOLVED — `due-first` sort option, no pinned section)*

**Resolved**: no pinned `<ReviewSection>` component. Instead, add a
**`due-first` sort option** to the Mastered collection's existing
sort cycle (Recent / A-Z / Mastery / Due first). When selected, due
verses sort to the top by ascending `daysUntilDue`, then everything
else falls in by recency. Reuses the badge to mark each verse as
Due / Locked / Engraved inline.

`due-first` uses local `useState` — same pattern as the existing
sort cycle. Sort doesn't persist across navigation in this feature;
the `library-sort-persistence` feature (built next) fixes that for
*all* sort options globally. Brief transient UX limitation, no
rework needed here.

The "Review now (N)" framing (formerly pinned-section header)
becomes a small label rendered above the list when sort is
`due-first`: *"3 verses due — review them first."* Lighter weight
than a separate component.

In Progress collection does NOT get `due-first` — In Progress verses
have no SR schedule; they're "still learning," not "needs review."
This is a clean separation we deliberately preserve (see "What does
NOT change").

### Q10: In Progress threshold — fixed or configurable? *(RESOLVED — lenient, no threshold)*

**Resolved**: any verse with a non-null `bestAccuracy` on *any*
difficulty (Easy / Medium / Hard) AND `!hard.completed` is "in
progress." Deduped by verse id. No threshold — touching a verse
once at any score puts it in progress.

This **matches the existing `useInsightsStats` definition** so the
Library In Progress collection count and the Insights "Verses in
progress" count are always identical. (Earlier drafts proposed a
≥50% Med/Hard threshold; that's been dropped to keep the two
metrics unified.)

## Technical Approach

### Data model changes

**One new migration**: `supabase/migrations/014_review_state.sql`.

We extend the existing `progress` JSONB on `user_verses` rather than
creating a new table — review state is per-verse, 1:1 with the
verse, already lives in the same JSONB; no orthogonal queries
justify a separate row.

**New shape of `progress.engraved`** (JSONB sub-object):

| Key | Type | Default | Nullable | Notes |
|---|---|---|---|---|
| `completed` | boolean | `false` | no | true once `passCount >= ENGRAVED_THRESHOLD` |
| `passCount` | number | `0` | no | monotonic; advances on successful, on-time review |
| `lifetimeReviews` | number | `0` | no | monotonic; advances per Q8 resolution |
| `nextDueAt` | string (ISO) | `null` | yes | local-midnight ISO; null until first mastery |
| `lastReviewedAt` | string (ISO) | `null` | yes | ISO timestamp of last successful Hard session |

Legacy field `months: string[]` is **preserved** by migration 014
for cross-client safety during the App Store rollout window. A
follow-up migration (e.g. `017_drop_engraved_months.sql`) drops it
~2 weeks after the new client is live in the App Store.

**Migration SQL** (additive):

```sql
-- 014_review_state.sql
-- Add new SR fields to user_verses.progress.engraved while
-- preserving the legacy `months` array for cross-client safety.
-- A follow-up cleanup migration drops `months` once the new client
-- is universally deployed.
--
-- Resulting shape (post-migration, transition state):
--   {
--     completed:       boolean   (preserved from legacy; preserved-true if was true)
--     months:          string[]  (preserved — legacy clients still read this)
--     passCount:       number    (new — seeded from months.length OR threshold if pre-engraved)
--     lifetimeReviews: number    (new — same seed as passCount)
--     nextDueAt:       null      (new — first new-client review will schedule)
--     lastReviewedAt:  null      (new — no month-precision data to seed from)
--   }
--
-- Critical seeding rule: if a row was already `completed: true`
-- pre-migration (a "fully engraved" verse with months.length === 4),
-- we MUST seed passCount >= ENGRAVED_THRESHOLD (10) so the new
-- client's `completed = passCount >= 10` derivation also returns
-- true. Otherwise pre-engraved users would silently lose their
-- engraved status.
--
-- Production data audit (2026-04-27) shows zero fully-engraved
-- verses across all users, so the engraved-preservation branch is
-- defensive but currently affects no real rows. We still encode it
-- correctly in case the data is ever backfilled or this migration
-- is re-run on a future system.
--
-- Skip rule: also handle rows where progress->'engraved' is JSON
-- null (defensively — should not exist but jsonb_set on null is
-- destructive).
--
-- Idempotent: re-running produces the same shape. Adds keys only;
-- never removes.

UPDATE public.user_verses
SET progress = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        progress,
        '{engraved,passCount}',
        to_jsonb(
          CASE
            -- Pre-engraved: seed at threshold so new client preserves engraved status.
            WHEN COALESCE((progress->'engraved'->>'completed')::boolean, false) = true
              THEN 10
            -- Otherwise: seed from months array length (0 to 4).
            ELSE COALESCE(jsonb_array_length(progress->'engraved'->'months'), 0)
          END
        )
      ),
      '{engraved,lifetimeReviews}',
      to_jsonb(
        CASE
          WHEN COALESCE((progress->'engraved'->>'completed')::boolean, false) = true
            THEN 10
          ELSE COALESCE(jsonb_array_length(progress->'engraved'->'months'), 0)
        END
      )
    ),
    '{engraved,nextDueAt}',
    'null'::jsonb
  ),
  '{engraved,lastReviewedAt}',
  'null'::jsonb
)
WHERE progress ? 'engraved'
  AND jsonb_typeof(progress->'engraved') = 'object'   -- guard against JSON null
  AND NOT (progress->'engraved' ? 'passCount');       -- skip already-migrated rows

-- Rows with no `engraved` sub-object yet (older rows, never engraved):
-- left alone. Client default-progress shape populates them on next write.
-- Both old and new clients tolerate the absence of `engraved`.
```

**Cleanup migration** (deferred, NOT shipped with 014):

```sql
-- 0NN_drop_engraved_months.sql  -- ship ~2 weeks after App Store release
-- The legacy `months` array is no longer read by any live client.
-- Drop it now that the App Store rollout window has closed.

UPDATE public.user_verses
SET progress = jsonb_set(
  progress,
  '{engraved}',
  (progress->'engraved') - 'months'
)
WHERE progress ? 'engraved'
  AND progress->'engraved' ? 'months';
```

**Verification queries** to run post-migration in Supabase Studio:

```sql
-- Every engraved sub-object should now have the new keys.
SELECT COUNT(*)
FROM user_verses
WHERE progress ? 'engraved'
  AND NOT (
    progress->'engraved' ? 'passCount' AND
    progress->'engraved' ? 'lifetimeReviews' AND
    progress->'engraved' ? 'nextDueAt' AND
    progress->'engraved' ? 'lastReviewedAt'
  );
-- Expected: 0

-- Pre-existing partial-progress users should have non-zero passCount.
SELECT
  user_id,
  COUNT(*) FILTER (WHERE (progress->'engraved'->>'passCount')::int > 0) AS verses_with_seeded_passCount
FROM user_verses
GROUP BY user_id
HAVING COUNT(*) FILTER (WHERE (progress->'engraved'->>'passCount')::int > 0) > 0;
```

**No new indexes needed.** Existing
`idx_user_verses_user (user_id) WHERE deleted_at IS NULL` already
supports "give me all my verses," which is the only access pattern
SR needs (selectors run client-side over the in-memory list).

**No RLS changes.** All review state lives inside
`user_verses.progress`, already gated by `auth.uid() = user_id`
policies from migration 002.

**No new functions, triggers, or RPCs.** `update_user_verses_updated_at`
already fires on UPDATE.

### Atomicity / sync impact

`progress` JSONB updates already flow through `updateVerseProgress`
in `lib/store/index.ts` and `updateProgress` in
`lib/storage/index.ts`. New fields ride along — single-row UPDATE,
no cross-table writes, no transaction needed. The optimistic-update
pattern in `updateVerseProgress` extends naturally (compute new
state → write to Supabase → on success, set in Zustand; on failure,
throw and don't update Zustand — same as today).

### Cache impact

**None.** Verse text caching (session cache,
`verse_cache` table) is unrelated to review state.

### Algorithm — full spec

```
On session end:
  let s = verse.progress.engraved (or default-shape if missing)
  let isHard = (difficulty === 'hard')
  let isFullSession = (allChunksCompleted)
  let isQualifying = isHard AND finalScore >= 90 AND isFullSession

  if NOT isQualifying:
    // No SR effect at all. Existing per-difficulty bestAccuracy
    // logic still updates as today; SR sub-object untouched.
    // lifetimeReviews does NOT increment (we only count
    // qualifying reviews — see Q8 resolution).
    return verse.progress (unchanged engraved sub-object)

  // Qualifying review.

  if s.nextDueAt === null:
    // First mastery — initialize SR.
    s.passCount = 1
    s.lifetimeReviews = 1
    s.lastReviewedAt = now()
    let intervalDays = min(s.passCount, userMaxIntervalDays)
    s.nextDueAt = nextLocalMidnightAfterDays(now(), intervalDays)
    s.completed = (s.passCount >= ENGRAVED_THRESHOLD)
    return s

  if now() < s.nextDueAt:
    // Locked (early). Lifetime ticks (cosmetic);
    // schedule and passCount untouched.
    s.lifetimeReviews += 1
    s.lastReviewedAt = now()
    return s

  // On-time or overdue.
  s.passCount += 1
  s.lifetimeReviews += 1
  s.lastReviewedAt = now()
  let intervalDays = min(s.passCount, userMaxIntervalDays)
  s.nextDueAt = nextLocalMidnightAfterDays(now(), intervalDays)
  s.completed = (s.passCount >= ENGRAVED_THRESHOLD)
  return s
```

**Engraving and the schedule are decoupled.** `passCount` keeps
incrementing past `ENGRAVED_THRESHOLD = 10` for every successful
review. `intervalDays = min(passCount, userMaxIntervalDays)` —
intervals grow monotonically until they hit the user's cap, then
plateau there. Engraved is a *milestone*: at passCount ≥ 10 we set
`completed = true` and the UI shows the engraved badge + lifetime
counter. The algorithm doesn't change after engraving. (Per Q3
resolution: engraving is cosmetic, not a state change.)

**Helper** in `lib/store/review.ts`:

```ts
/**
 * Returns the ISO UTC timestamp of local midnight `daysFromNow` days
 * after `now`. The "midnight" is in the device's current local
 * timezone, then converted to UTC for storage. So a review at
 * Mon 11pm PT with daysFromNow=1 returns Tue 00:00 PT (= Tue 07:00 UTC).
 *
 * The verse becomes "due" at this exact instant. In the user's local
 * tz, that means the verse is due for the entire calendar day named
 * by the date portion of the result (e.g. all of Tuesday in PT).
 *
 * For DST transitions: the math uses Date.setHours(0, 0, 0, 0) on
 * a date constructed via `new Date(now)` then `setDate(getDate() + N)`
 * which respects the device's then-current DST. Travel across
 * timezones uses the new tz's midnight.
 */
function nextLocalMidnightAfterDays(now: Date, daysFromNow: number): string {
  const target = new Date(now);
  target.setDate(target.getDate() + daysFromNow);
  target.setHours(0, 0, 0, 0);
  return target.toISOString();
}
```

**Worked example** (resolves Q5):

- User reviews **Mon 23:00 PT**. passCount goes 0 → 1.
  - `nextLocalMidnightAfterDays(Mon 23:00 PT, 1)` →
    Tue 00:00 PT → stored as `2026-04-29T07:00:00.000Z`.
  - The verse becomes "due" at Tue 00:00 PT, i.e. **just 1 hour
    after the review**.
  - Intentional: any review on Tuesday counts as on-time. The
    interval is "calendar-day-aligned," not "24-hours-from-now."
- Same user, on **Tue 09:00 PT**, completes another qualifying
  review. passCount goes 1 → 2.
  - `nextLocalMidnightAfterDays(Tue 09:00 PT, 2)` →
    Thu 00:00 PT.
  - Verse becomes due Thursday.

This is intentionally identical to Bible Memory App's day-bucket
behavior. Edge of midnight (review at 11:59pm) gets a tiny on-time
window; that's acceptable noise.

**Constants** in `lib/store/review-config.ts` (new file):

```ts
export const ENGRAVED_THRESHOLD = 10;             // pending Q1
export const DEFAULT_MAX_INTERVAL_DAYS = 90;       // pending Q2
export const MIN_USER_MAX_INTERVAL_DAYS = 14;
export const MAX_USER_MAX_INTERVAL_DAYS = 365;
export const IN_PROGRESS_MIN_BEST_ACCURACY = 50;   // pending Q10
```

These are not user-set per-verse — `userMaxIntervalDays` comes from
a Zustand setting (`reviewMaxIntervalDays`), backed by AsyncStorage.

### API / edge function changes

**None.** No edge function, no Supabase RPC. SR scheduling is
entirely client-side off the in-memory verse list. We do **not**
add a server-side Postgres filter for "due verses"
(no `progress->'engraved'->>'nextDueAt' < now()` query) — all
due-set computation runs in the client by mapping over the already-
loaded verse list. This keeps the data layer simple and avoids
needing a new index.

### Client changes

**Files added**:

- `lib/store/review-config.ts` — constants (above).
- `lib/store/review.ts` — pure functions:
  - `computeNextSrState(prev: EngravedProgress, finalScore: number,
    difficulty: Difficulty, fullSession: boolean, now: Date,
    maxIntervalDays: number): EngravedProgress`
  - `isDueForReview(verse: SavedVerse, now: Date): boolean`
  - `daysUntilDue(verse: SavedVerse, now: Date): number`
  - `dueVersesFor(verses: SavedVerse[], now: Date): SavedVerse[]`
  - `lockedVersesFor(verses: SavedVerse[], now: Date): SavedVerse[]`
  - `midnightLocal(d: Date): string`
  - All pure / no side effects / unit-testable.
- `components/library/ReviewStateBadge.tsx` — switches between
  pre-mastery (renders null) / Locked / Due / Engraved per
  `useReviewState(verseId)`. (Spike scaffold exists on
  `ui-spike-review-system` branch as reference.)
- `components/library/DueCountPill.tsx` — small "N due" pill.
  (Spike scaffold exists.)

(NOTE: no separate `ReviewSection` component — see Q9 resolution.
The pinned-section idea collapsed into a sort option +
`due-first` ordering. NOTE: no new `ReviewInfoModal.tsx` either —
the existing `components/study/ProgressInfoModal.tsx` is updated
in place; see Files modified.)

**Files modified**:

- `lib/storage/index.ts` —
  - Update `EngravedProgress` type. Add: `passCount: number`,
    `lifetimeReviews: number`, `nextDueAt: string | null`,
    `lastReviewedAt: string | null`. Keep `months?: string[]` as
    *optional* on the type (so the new client tolerates rows that
    still have legacy `months`-only shape, and so the type remains
    valid while the deferred cleanup migration is pending).
  - Update the **single canonical `DEFAULT_PROGRESS`** in this file
    to seed the new fields with `0` / `null` and an empty
    `months: []`. (See "Three DEFAULT_PROGRESS sources" below —
    consolidate to this one.)
  - Keep `engraved?:` optional on `VerseProgress` so older in-memory
    rows missing the sub-object entirely don't crash on read.
  - Add a new exported pure helper:
    ```ts
    export function parseEngravedProgress(raw: unknown): EngravedProgress {
      // Defensive: handle null, undefined, non-objects.
      const e = (raw && typeof raw === 'object') ? raw as Partial<EngravedProgress> : {};
      const months = Array.isArray(e.months) ? e.months : [];
      // Read-fallback: derive passCount from legacy `months.length`
      // if the new fields aren't present (pre-migration row, or
      // an old client overwrote a new-client-shaped row).
      const passCount = typeof e.passCount === 'number'
        ? e.passCount
        : months.length;
      const lifetimeReviews = typeof e.lifetimeReviews === 'number'
        ? e.lifetimeReviews
        : months.length;
      // Preserve completed if it was true; otherwise derive from passCount.
      const completed = e.completed === true || passCount >= ENGRAVED_THRESHOLD;
      return {
        completed,
        passCount,
        lifetimeReviews,
        nextDueAt: typeof e.nextDueAt === 'string' ? e.nextDueAt : null,
        lastReviewedAt: typeof e.lastReviewedAt === 'string' ? e.lastReviewedAt : null,
        months, // kept for cross-version safety; new client never reads it after this point
      };
    }

    export function parseProgress(raw: unknown): VerseProgress {
      const p = (raw && typeof raw === 'object') ? raw as Partial<VerseProgress> : {};
      return {
        easy:     p.easy     ?? { bestAccuracy: null, completed: false },
        medium:   p.medium   ?? { bestAccuracy: null, completed: false },
        hard:     p.hard     ?? { bestAccuracy: null, completed: false },
        engraved: parseEngravedProgress(p.engraved),
      };
    }
    ```
  - **Replace all 5 read-paths** that currently do
    `progress: row.progress || DEFAULT_PROGRESS` with
    `progress: parseProgress(row.progress)`. Specific lines:
    - `lib/storage/index.ts:286` (`getSavedVerses`)
    - `lib/storage/index.ts:332` (`getVersesByCollection`)
    - `lib/storage/index.ts:626` (`getMasteredVerses`)
    - `lib/store/index.ts:218` (`fetchVerses` action)
    - `lib/store/index.ts:257` (`fetchMasteredVerses` action)
    - Also the write-path read at `lib/storage/index.ts:413`
      (saveVerse restoration) and `:574` (similar) — these read
      existing progress before re-saving; use `parseProgress` here
      too so re-saves preserve SR state correctly.
  - This handles: (a) pre-migration rows on the new client,
    (b) rows where an old client overwrote a new-client-shaped row
    after the migration, and (c) any malformed JSONB. Single source
    of truth.

**Three `DEFAULT_PROGRESS` sources today** (`lib/storage/index.ts:62`,
`lib/store/index.ts:43`, and inline at `lib/store/index.ts:808`
inside `resetVerseProgress`). Consolidate to **one** in
`lib/storage/index.ts`. Delete the duplicates in `lib/store/index.ts`
(both top-level and inline) and import from storage. This ensures
`resetVerseProgress` writes the correct new-shape default with
`passCount: 0`, `nextDueAt: null`, etc.
- `lib/store/index.ts` —
  - Refactor `updateVerseProgress` to call `computeNextSrState`
    (from `lib/store/review.ts`) instead of inline month logic.
    Continue the existing **write-then-set** pattern (write to
    Supabase first; on success, `set(...)` to update Zustand; on
    failure, throw and don't update). Today's path is *not*
    optimistic, so there is no rollback to extend — match the
    existing pattern.
  - Remove `isConsecutiveMonth` helper (no longer used).
  - Delete the duplicate top-level `DEFAULT_PROGRESS` (line 43)
    and the inline one inside `resetVerseProgress` (line 808).
    Import the single canonical one from `lib/storage`.
  - Add `IN_PROGRESS_COLLECTION_ID = 'in-progress'` constant. (Note:
    user collection client_ids follow the pattern
    `collection-${Date.now()}` — `'in-progress'` cannot collide.
    Same for `MASTERED_COLLECTION_ID = 'mastered'` which already
    exists. The architecture doc `library-and-collections.md` has a
    bug on line 59 saying `'@mastered'` — fix in Chunk 6.)
  - Add `IN_PROGRESS_COLLECTION` virtual collection (mirrors
    `MASTERED_COLLECTION`).
  - Update `useInsightsStats` to use the same lenient In Progress
    rule as the new collection (drop any threshold; "any non-null
    bestAccuracy on any difficulty AND !hard.completed"). This
    matches the existing Insights behavior, so it's a no-op for
    most users — the change is *making them stay equal* by
    referencing the same selector.
  - Add selectors:
    - `useInProgressVerses()` → dedup by id, filter:
      `(easy.bestAccuracy !== null
        || medium.bestAccuracy !== null
        || hard.bestAccuracy !== null)
      && !hard.completed`. (Lenient — Q10 resolution.)
    - `useReviewState(verseId)` → `'pre-mastery' | 'locked' | 'due'
      | 'engraved'` per the precedence table in §UI.
    - `useDueCounts()` → `{ mastered: number }`. (Removed
      `inProgress` — In Progress verses have no SR schedule and
      cannot be "due" in the SR sense. Q10 resolution.)
  - Add `reviewMaxIntervalDays` to state (default
    `DEFAULT_MAX_INTERVAL_DAYS = 90`), action
    `setReviewMaxIntervalDays(n)` that persists to AsyncStorage,
    key `review_max_interval_days`.
  - **`clear()` change**: today's `clear()` calls `set(...)` with
    explicit fields (collections, verses, masteredVerses, hydrated,
    loading flags, error). Anything *not* listed is preserved by
    Zustand naturally — that's how `colorMode` and `bibleVersion`
    already survive sign-out. So we do NOT add `reviewMaxIntervalDays`
    to the set call; it's preserved by the same omission pattern.
    Add a comment (matching the existing `// Note: colorMode is NOT
    cleared` comment) listing all device prefs preserved.
  - Hydrate: extend the existing `Promise.all` of AsyncStorage
    reads to include `review_max_interval_days`. Apply via the
    same `updates` accumulator before the final `set(updates)`.
- `lib/storage/index.ts` `getCollections()` — emit the In Progress
  virtual collection like Mastered.
- `app/(tabs)/(library)/index.tsx` — render In Progress collection
  in the list when `useInProgressVerses().length > 0`. Add
  `<DueCountPill>` to the **Mastered** row only (In Progress has
  no SR schedule and no "due" concept; per Q9/Q10).
- `app/(tabs)/(library)/[id].tsx` — when the collection is
  Mastered:
  - Extend the existing sort cycle to include `due-first`
    (Recent → A-Z → Mastery → Due first → Recent…). Only available
    on the Mastered collection — `due-first` doesn't apply
    elsewhere.
  - When `due-first` is the active sort, render a small label
    above the list: *"N verses due — review them first."*
  - Inline the comparator: sort by ascending `daysUntilDue`
    (overdue / due-now first), then by `createdAt DESC` for ties.
    Use `daysUntilDue(verse, now)` from `lib/store/review.ts`.
  - Sort selection itself uses the existing local-`useState`
    pattern. (Persistence across navigation comes later via the
    `library-sort-persistence` feature.)
- `app/(tabs)/(library)/setup/[id].tsx` — **only consumer** of
  `<ProgressCard>`. Manually verify on device after the ProgressCard
  rework.
- `components/study/ProgressCard.tsx` — replace the 4-month-chip
  ladder with `X / 10` numeric + horizontal progress bar. Show:
  - **Pre-mastery** (no Hard 90% yet): empty bar, count `0 / 10`,
    no extra status line.
  - **Locked** (`hard.completed && now < nextDueAt`): lock icon,
    dimmed bar, "Unlocks in Nh" if <24h or "Unlocks in N days"
    otherwise.
  - **Due** (`hard.completed && (nextDueAt === null || now >= nextDueAt)
    && !engraved.completed`): gold pulse on the bar, "Ready to
    Review" header, "Review now to advance" callout pill.
  - **Engraved** (`engraved.completed`): existing gold treatment,
    lifetime count line ("47 lifetime reviews"), tagline.
  - Remove unused helpers: `getMonthLabel`, `getEngravedDate`,
    `getFutureMonthLabel`. Remove unused styles (`circleWrapper`,
    `monthLabel`, `connectingLine`, etc.).
  - Spike branch (`ui-spike-review-system`) has full reference
    visuals for all four variants.
- `components/study/ProgressInfoModal.tsx` — **update in place**
  (do NOT add a new file). Replace the current "Engraved: 4
  consecutive months" copy with the new mechanic (e.g. "Engraved:
  10 successful reviews on the schedule"). The existing
  `ProgressInfoButton` and modal API stay; only the body text and
  any visual references change.
- `components/library/SwipeableVerseCard.tsx` —
  - Replace the direct `EngravedIcon` use with
    `<ReviewStateBadge>`.
  - Keep the gold-glow-when-engraved styling (read from
    `progress.engraved.completed` — same field name, new
    semantics).
- `app/(tabs)/settings.tsx` — add "Review System" section:
  - **Slider**: max review interval days, range
    `MIN_USER_MAX_INTERVAL_DAYS` (30) to
    `MAX_USER_MAX_INTERVAL_DAYS` (365), default
    `DEFAULT_MAX_INTERVAL_DAYS` (90), step = 1 day. Display the
    current value above the slider as a label
    (e.g. "Maximum review interval: 90 days").
  - "How does this work?" link → opens the updated
    `ProgressInfoModal` (re-used; not a new modal).
  - Use `@react-native-community/slider` if available; otherwise a
    minimal custom slider styled to match the codebase. The
    builder picks the implementation; both are fine.

**Files removed**: none. (The legacy `isConsecutiveMonth` helper in
`lib/store/index.ts` will be removed inline in the same edit, not
as a separate file deletion.)

### State changes

| State | Owner | Persisted |
|---|---|---|
| `reviewMaxIntervalDays: number` | Zustand + AsyncStorage (`review_max_interval_days`) | Yes (device pref) |

`clear()` preserves this by **omission** — the existing pattern
calls `set({ collections, verses, masteredVerses, hydrated,
loading flags, error })` and anything not listed is preserved by
Zustand. `colorMode` and `bibleVersion` already survive sign-out
this way; `reviewMaxIntervalDays` joins them.

The new `EngravedProgress` shape is part of `progress` JSONB, so it
syncs through the existing pipeline. No new sync surface.

### UI

**`ReviewStateBadge`** has four visual states. The state precedence
is engraved > due > locked > pre-mastery (Engraved is sticky once
earned; an engraved verse that's also due renders as Engraved with
its lifetime count, and the due-ness is conveyed by sort order).

| State | Trigger | Visual |
|---|---|---|
| pre-mastery | `!hard.completed` | (no badge — verse hasn't entered SR yet) |
| Due | `hard.completed && (nextDueAt === null OR now >= nextDueAt) && !engraved.completed` | Accent (`colors.tint`) chip, text "Review now". (Pulse animation = nice-to-have.) |
| Locked | `hard.completed && nextDueAt !== null && now < nextDueAt && !engraved.completed` | Muted neutral chip, text "Next review in 3d" / "tomorrow". |
| Engraved | `engraved.completed === true` | Existing `EngravedIcon` + lifetime count text "47 reviews"; gold tint. |

**Note on `nextDueAt === null`** (legacy migrated rows): a verse
that was mastered pre-migration has `hard.completed === true` but
`nextDueAt === null` (the migration didn't seed timestamps). We
treat this as **Due** so the user is encouraged to review and
trigger first SR scheduling. The first qualifying review will set
`nextDueAt` properly per the algorithm.

When a verse is both Engraved and Due (engraved verses still get
maintenance reviews on the same ladder), the Engraved variant wins
for the icon, and the Due indicator surfaces via the
`due-first` sort placing the verse at the top of the list. The
badge itself shows engraved status with the lifetime number; the
"due-ness" is communicated by sort position, not a second badge.

**`DueCountPill`** — small rounded pill, `colors.tint` background,
white text, 12px. "3 due" / "1 due". Hidden when count = 0. Renders
on the **Mastered** collection card only — In Progress collection
does not get a due pill (per Q9 + Q10 resolutions; In Progress
verses have no SR schedule and can't be "due").

**Updated `ProgressInfoModal`** (existing file
`components/study/ProgressInfoModal.tsx` — modify in place, do NOT
add a new file):

> *Each mastered verse comes back for review on a schedule. The
> first review is 1 day later, then 2, then 3, doubling-ish from
> there. Practice 10 times and you've engraved it.*

(Modal copy may evolve based on Q1 / Q2 resolution.)

### Edge cases

- **Offline at session end**: `updateVerseProgress` already
  exception-throws on Supabase write failure; SR state update is
  not applied locally. No SR drift, but the session was effectively
  lost (existing sharp edge — not introduced here; documented in
  `sync-and-storage.md`).
- **Older rows without `engraved` field**: client default-progress
  shape supplies the new fields on first write. Read paths must
  treat all new fields as nullable until then. The
  `useReviewState(verseId)` selector handles this:
  `engraved == null || nextDueAt == null` → `'pre-mastery'`.
- **Pre-migration row read by new client** (legacy `months` array,
  no `passCount`): the storage-layer read normalizes
  `passCount := months?.length ?? 0` and `lifetimeReviews :=
  months?.length ?? 0` on the way into the in-memory `SavedVerse`.
  `nextDueAt` and `lastReviewedAt` remain null until the user
  completes their next 90%-Hard session (which then writes the
  full new shape via `updateVerseProgress`). This matters during
  the App Store rollout window when the migration may not have
  been applied yet — see "Deployment sequencing" above.
- **Old client overwrote `progress` after migration**: if an old
  client (still on the legacy code path) writes `progress` after
  migration 014 has been applied, their write will only contain
  `months` and `completed` — the new fields will be missing from
  that row again. On the next new-client read, the storage-layer
  normalization re-derives `passCount := months.length` and the
  row is "re-migrated" in memory. The next new-client write
  re-persists the full new shape. Eventual consistency.
- **DST transitions**: `nextDueAt` is stored as ISO; comparison is
  `Date.now() >= new Date(nextDueAt).getTime()`. Local midnight is
  computed at write time using the device's then-current TZ. DST
  shifts during a 1-day interval add or subtract 1 hour from the
  exact moment of transition, but a Locked verse will not flip Due
  early because `getTime()` is monotonic. Worst case: a DST-transition
  day's verse becomes Due 1h late; acceptable.
- **Travel across timezones**: same logic. If a user reviews in PT
  (midnight stored as PT-local), then flies to ET, the verse becomes
  Due at the originally-scheduled UTC moment, which is 3h later
  than ET local midnight on the due date. Effect: a tiny window
  where the verse is "supposed to be due tomorrow" but appears Due
  3h before tomorrow's local midnight. Acceptable.
- **User changes the max-cap setting**: existing `nextDueAt` values
  are not retroactively recomputed. The new cap takes effect on the
  *next* successful review. Intentional — retroactive recompute
  would surprise users.
- **`resetVerseProgress`**: must wipe SR state too. Update
  `DEFAULT_PROGRESS` to include the new fields with `0`/`null`;
  `resetVerseProgress` already writes `DEFAULT_PROGRESS` so it
  inherits.
- **Re-mastering a soft-deleted verse**: existing restore path
  preserves the row's `progress` JSONB, so SR state is preserved.
  No new code.
- **Engraved verse soft-deleted**: stays in Mastered, badge still
  reads "Engraved", `lifetimeReviews` preserved. No new code.
- **Verse becomes Due while user has the screen open**: the badge
  updates only on next selector evaluation. To avoid stale-Locked
  state forever, the Library screen should re-evaluate every minute
  (or on focus). Implementation: a `useFocusEffect` that calls
  `setNow(new Date())` and a `setInterval(60000)` while focused.
- **Concurrent updates from two devices**: the existing storage
  layer is last-write-wins. SR state is not exempt — if a user
  reviews on phone A and phone B in the same minute, the one that
  writes second overwrites. Acceptable for personal use; worst case
  loses one passCount increment.

### Delete / reset interaction matrix

The new SR fields live inside `user_verses.progress` JSONB, so
they ride along with every existing delete/restore/reset path. The
table below enumerates every way a verse can lose its SR state and
what the user-visible effect is. **All flows below are existing
behavior; this feature inherits them.**

| Action | What happens to the verse row | What happens to SR state |
|---|---|---|
| Remove verse from collection (in OTHER collections too) | Junction row deleted only. `user_verses` untouched. | **Preserved.** |
| Remove verse, only collection, mastered (`hard.completed`) | Junction deleted; `deleted_at = NOW()` (soft delete). Verse stays in Mastered. | **Preserved** in the soft-deleted row. |
| Remove verse, only collection, not mastered | Junction deleted; `user_verses` row hard-deleted. `verse_collections` cascades; `session_attempts` survives. | Lost (was unset anyway — SR initializes only at first 90% Hard). |
| Re-add a soft-deleted verse | Existing row restored: `deleted_at = NULL`. `progress` JSONB intact. | **Preserved.** SR resumes from where it was — including `passCount`, `nextDueAt`, etc. |
| `resetVerseProgress` (Setup menu) | `progress = DEFAULT_PROGRESS`. `hard.completed` flips false → verse drops out of Mastered. | **Wiped.** `passCount = 0`, `nextDueAt = null`, `lifetimeReviews = 0`, `completed = false`. Engraved status lost (intentional — see Reset copy update in Chunk 4). |
| Delete entire collection (custom) | For each verse: applies the per-verse logic above (in-other / mastered-soft / unmastered-hard). | Per-verse: same as above. |
| Mastered virtual collection | Cannot be deleted (UI + store guard). Cannot have verses removed via swipe (disabled). | N/A — verse stays. |

**Implication for the new `parseProgress` helper**: any path that
writes a default-shaped `progress` (saveVerse for a new verse,
`resetVerseProgress`) must use the **single canonical
`DEFAULT_PROGRESS`** in `lib/storage/index.ts` (with all the new
SR fields). If even one of the three legacy `DEFAULT_PROGRESS`
constants is left un-updated, the corresponding flow will write a
malformed shape — which `parseProgress` would heal on next read,
but only after a write/read round-trip. Consolidate to one source
of truth.

**Implication for the Reset confirmation copy**: today's alert
says *"This will clear all scores and remove this verse from your
Mastered list."* It must be updated to acknowledge the SR wipe.
See Chunk 4 file list.

### What does NOT change

- The study session loop, scoring, alignment, chunk masking — all
  unchanged. SR is consulted only *after* the session ends.
- `session_attempts` table — unchanged. SR state is derived
  exclusively from `user_verses.progress`.
- `verse_cache`, `usage_daily`, `subscriptions`, edge functions —
  none touched.
- The `updateVerseProgress` invariant (CLAUDE.md #7) — mastery
  progression *still* lives in the Zustand store; we are extending
  what "progression" means, not relocating it.
- Bible API and caching — completely untouched.
- KJV bundle path — untouched.
- The Mastered virtual collection mechanism — unchanged. New
  In Progress collection mirrors its synthesis pattern exactly.
- Library swipe semantics, the `verse_collections` junction —
  unchanged.
- Auth, deep linking for password reset / OAuth — unchanged.

## Deployment sequencing

The app has one prod DB, one prod codebase, and a 3-day-to-1-week
App Store review delay. Users update their app on their own
schedule (could be the day it lands, could be never). We can't
time-coordinate "migration applied" with "everyone has new code."
So safety lives entirely in **client-side tolerance**, not in
deployment timing.

**Three rules**:

1. **Migration 014 is additive** — adds the new SR fields, does
   NOT remove `months`. Safe to push at any time.
2. **New client read path tolerates both shapes.** When parsing
   `progress.engraved` from a Supabase row in `lib/storage/index.ts`,
   if `passCount` is missing but `months` exists, derive
   `passCount := months.length` and `lifetimeReviews := months.length`
   in memory before constructing the `SavedVerse`. This makes the
   new client work whether it sees a pre-migration row or a
   post-migration row.
3. **Cleanup migration** (drops `months`) ships whenever you're
   confident enough users have updated. No hard deadline, no
   coordinated push.

**Deploy order** is now boring:

- Push migration 014 to prod whenever (before, during, or after the
  App Store release — doesn't matter).
- Submit new client to App Store. Users update on their schedule.
- Old clients keep working on the migrated DB (they read `months`,
  ignore the new fields, write `months` on engraving updates).
- New clients keep working on the un-migrated DB (they read
  `months`, derive `passCount` in memory, write the new fields).
- Once the App Store dashboard shows essentially everyone updated,
  push a cleanup migration that drops `months`.

**Old client behavior during the transition** (informational, not
something we fix): an old client may overwrite a row's `progress`
JSONB after a new client wrote the new fields. The old client's
write keeps `months` and `completed` but doesn't preserve
`passCount` etc., so the new fields are gone from that row. On the
next new-client read, the read-path normalization re-derives
`passCount := months.length`. The verse's `passCount` is reset to
the legacy `months.length` (max 4) and the `nextDueAt` is lost.
The user just has to do their next review and the schedule
re-initializes. Acceptable for a small user base and a transient
window.

**No dual-write.** The new client does NOT update `months` when it
writes. We accept that old clients in the wild won't see the new
review counts (their engraving UI shows whatever they last did on
old code). This is simpler than dual-write and the cost is
invisible to anyone using the new client.

## Build order

Each chunk is a PR-sized commit that leaves the app in a working
state.

**No cross-feature dependency.** This feature builds and ships
end-to-end on its own. The `due-first` sort introduced in Chunk 4
uses local `useState` — same pattern as the existing
Recent / A-Z / Mastery cycle in `app/(tabs)/(library)/[id].tsx`.
After this feature is shipped and tested, the
`library-sort-persistence` feature is built next and makes all
sort options durable globally — no rework needed in this feature
beyond what sort-persistence touches as part of its own scope.

### Chunk 1 — Migration + types + pure SR logic

Branch: `review-1-data-and-logic`

Goal: schema migrated, types updated, pure-function SR logic exists
with unit tests. **No UI changes; no scheduling.** The new fields
are written by the existing `updateVerseProgress` path but nothing
yet reads them visually.

Files:
- `supabase/migrations/014_review_state.sql` — migration above.
- `lib/storage/index.ts`:
  - Update `EngravedProgress` type. Add `passCount`,
    `lifetimeReviews`, `nextDueAt`, `lastReviewedAt`. **Keep
    `months?: string[]` as optional** — required so that
    `ProgressCard.tsx` (still reading legacy fields until Chunk 4)
    continues to compile, AND so that the new client tolerates
    pre-migration rows.
  - Update the canonical `DEFAULT_PROGRESS` to include the new
    fields with safe defaults (`0`, `null`, `[]` for `months`).
  - Add `parseProgress` and `parseEngravedProgress` helpers.
  - Replace all 5+ read-paths to use `parseProgress`.
  - Keep `engraved?:` optional on `VerseProgress`.
- `lib/store/review-config.ts` — constants.
- `lib/store/review.ts` — pure helpers (`computeNextSrState`,
  `isDueForReview`, `daysUntilDue`, `dueVersesFor`,
  `nextLocalMidnightAfterDays`) + unit tests in
  `lib/store/__tests__/review.test.ts` (or co-located).
- `lib/store/index.ts`:
  - Refactor `updateVerseProgress` to call `computeNextSrState`.
  - Remove `isConsecutiveMonth` helper.
  - Delete duplicate `DEFAULT_PROGRESS` (top-level + inline in
    `resetVerseProgress`); import the canonical one from storage.

Validation:
- `npx tsc --noEmit` clean — verify in particular that
  `ProgressCard.tsx` still compiles (because `months?:` is kept
  optional). `npm run lint` clean.
- The migration file is committed but **NOT applied** to prod yet
  (see "Deployment sequencing" above). Apply it locally only:
  `supabase migration up` against a local DB to verify the SQL
  parses and produces the expected shape on a fixture row.
- Manual cross-shape test: against a *local* DB with both
  legacy-`months` rows AND already-migrated rows, confirm
  `useReviewState(verseId)` returns sensible values for both.
- Plan to apply migration 014 to prod **only after** the App Store
  build is approved and live (per playbook).

### Chunk 2 — In Progress collection + due selectors

Branch: `review-2-in-progress`

Goal: synthesize the In Progress virtual collection in the store;
expose due selectors. No new badges yet — just data layer.

Files:
- `lib/store/index.ts`:
  - `IN_PROGRESS_COLLECTION_ID = 'in-progress'`,
    `IN_PROGRESS_COLLECTION` virtual collection object.
  - Selectors: `useInProgressVerses` (lenient — any non-null
    bestAccuracy), `useReviewState`, `useDueCounts` (returns
    `{ mastered: number }` only).
  - Update `useInsightsStats` to ensure its In Progress count
    matches the new selector exactly (drop any divergence).
- `lib/storage/index.ts` `getCollections()` — emit In Progress
  virtual collection.
- `app/(tabs)/(library)/index.tsx` — render In Progress collection
  row (still using existing CollectionCard styling, no pill yet).

Validation: device test — In Progress shows up in Library when
applicable; counts match expectation.

### Chunk 3 — Verse card badge + collection-row pills

Branch: `review-3-badges`

Goal: visible review state UI.

Files:
- `components/library/ReviewStateBadge.tsx` — new (4 states:
  pre-mastery / Locked / Due / Engraved).
- `components/library/DueCountPill.tsx` — new.
- `components/library/SwipeableVerseCard.tsx` — wire badge in;
  replace direct `EngravedIcon` use (Q3 resolution: unified badge).
- `app/(tabs)/(library)/index.tsx` — `<DueCountPill>` on the
  **Mastered** row only (not In Progress).

Validation: device test — badges show correct state for each
verse; pills update in real time after a session.

### Chunk 4 — Due-first sort + ProgressCard rework

Branch: `review-4-due-first-and-progress-card`

Goal: due verses naturally rise to the top of Mastered via a new
sort option; Setup screen ProgressCard switches from month-chip
ladder to `X / 10` numeric + bar with Locked / Due / Engraved
variants.

**No external dependency.** `due-first` uses local `useState` like
the existing sort cycle. Sort persistence is a separate sibling
feature shipped after this one.

Files:
- `app/(tabs)/(library)/[id].tsx` — when collection is Mastered,
  extend the sort cycle to include `due-first` (Recent → A-Z →
  Mastery → Due first → Recent…). Inline the sort comparator
  alongside the existing ones (no extracted `library-sort.ts`
  helper yet — that lands in the sort-persistence feature). When
  `due-first` is active, render the small label
  *"N verses due — review them first."* above the list.
- `app/(tabs)/(library)/setup/[id].tsx` — **only consumer** of
  `<ProgressCard>`; manually verify visuals on device.
- `components/study/ProgressCard.tsx` — replace 4-month-chip
  ladder with `X / 10` numeric + horizontal bar; render Pre-mastery
  / Locked / Due / Engraved variants per §UI; remove
  `getMonthLabel`, `getEngravedDate`, `getFutureMonthLabel`,
  `circle*` styles, and `connectingLine*` styles (all unused once
  chips are gone). At this point, the type's `months?:` can finally
  be removed in a follow-up cleanup migration; until then, leave it
  alone. Spike branch is the visual reference.
- `components/study/ProgressInfoModal.tsx` — **modify in place**.
  Replace the "Engraved: 4 consecutive months" copy with the new
  "Engraved: 10 successful reviews" copy. Keep the same
  `ProgressInfoButton` API.
- (Optional nice-to-have) "Review all due" button somewhere in
  the Mastered detail when due-first is active.

Also: update the `Reset Progress?` Alert copy in
`app/(tabs)/(library)/setup/[id].tsx:118` to mention review
schedule + engraved status:

> "Reset Progress?"
> "This will clear all scores, your review schedule, and engraved
> status, and remove this verse from your Mastered list."

Validation: on device, with the migration applied locally and a
verse marked due, confirm the verse rises to top under `due-first`,
sort persists across navigations, and Setup screen badge variants
flip correctly.

### Chunk 5 — Settings cap

Branch: `review-5-settings`

Goal: user can tune max interval. (The info modal was already
updated in Chunk 4 by modifying `ProgressInfoModal.tsx` in place;
no new modal here.)

Files:
- `lib/store/index.ts` — `reviewMaxIntervalDays` state,
  `setReviewMaxIntervalDays(n)` action, AsyncStorage hydration in
  the existing `Promise.all` block, persistence in the action.
  `clear()` preserves it via the existing omission pattern (no
  explicit exemption code needed; just don't list it in `set(...)`
  inside `clear`).
- `app/(tabs)/settings.tsx` — "Review System" section with a
  slider (range 30–365, default 90, step 1) plus a value label.
  Link "How does this work?" opens the existing
  `ProgressInfoModal`.

Validation: device test — change the cap, complete a review,
verify next interval respects cap.

### Chunk 6 — Doc graduation

Files:
- `docs/architecture/data-model.md` — update `progress` JSONB shape
  in the `user_verses` section to reflect the new
  `engraved` sub-object (with the new fields).
- `docs/architecture/study-session.md` — update mastery progression
  step 8 to reference `lib/store/review.ts`.
- `docs/architecture/library-and-collections.md`:
  - Document the In Progress virtual collection alongside Mastered.
  - **Fix the existing bug at line 59**: the doc says
    `MASTERED_COLLECTION_ID = '@mastered'` but the actual code
    (`lib/storage/index.ts:76`) uses `'mastered'` (no `@` prefix).
    Same for any other places in this file mentioning `@mastered`.
  - Document `IN_PROGRESS_COLLECTION_ID = 'in-progress'` next to it.
- `docs/architecture/insights-and-streaks.md` — note that engraved
  is now derived from `passCount`, not month streaks. Confirm the
  In Progress count there matches the new selector exactly.
- `docs/architecture/sync-and-storage.md` — note the new
  AsyncStorage key (`review_max_interval_days`) in the table, and
  the new device-pref preserved by `clear()`.
- `CLAUDE.md`:
  - Update the "Engraved progress streak uses string month
    comparison" sharp edge — replace with a note about SR state
    living in `progress.engraved.{passCount,nextDueAt,…}`.
  - Update invariant #7 wording (stays accurate; SR is the new
    "progression").
- `docs/features/review-system.md` — flip status to `shipped`,
  fill in "What Was Built".

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Replace 4-consecutive-month engraving with N-pass SR threshold | DB query: 0 fully engraved, 12 users with progress, max 2 months on any verse. Current model is functionally unused. |
| 2026-04-27 | Linear-day intervals (passCount = days to next) | User preference after walking through doubling vs graduated; "covers ~2 months at fastest" lands at N=10 with triangular sum |
| 2026-04-27 | Early review never advances passCount | Spaced repetition only works if reviews are spaced; locking out same-day-grinding preserves the algorithm's premise |
| 2026-04-27 | Local notifications and copy deferred to sibling doc | Two different risk profiles; review system substrate ships first and bakes before notifications layer on |
| 2026-04-27 | iOS-only feature; Android deferred | App is iOS-only today |
| 2026-04-27 | Server-side SR computation rejected | Client-side off in-memory list is enough; no edge function or RPC |
| 2026-04-27 | Migration 014 is purely additive; cleanup deferred ~2 weeks | App Store review delay (3 days+) creates a window where old and new clients coexist against the migrated DB. Additive migration + new-client tolerance of legacy shape avoids breakage on either side. See "Deployment sequencing" section. |
| 2026-04-27 | New client does NOT dual-write `months` | Asymmetric model: old clients keep writing `months`, new clients read-fallback from it but write only new fields. Trades brief engraving-UI inconsistency on old clients for simpler new-client code. Acceptable for small user base and 2-week rollout window. |
| 2026-04-27 | No "Review" virtual collection | Mastered + In Progress already cover the user mental model. A third "Review" virtual collection would intersect them and confuse "where do I go?". Review state is shown on Mastered via badges + due-first sort + small label. |
| 2026-04-27 | In Progress does NOT get review/SR scheduling | In Progress = "still learning"; Review/SR = "maintain what you've already mastered." Different lifecycles. In Progress notifications planned later as their own concern (notification-system). |
| 2026-04-27 | Q9: due-first sort instead of pinned ReviewSection component | After spike, a sort option felt cleaner than a separate component. Removes one component from the build, reuses the existing sort UI, and lets the user pin/unpin the surface by toggling sort. |
| 2026-04-28 | Build review-system fully before library-sort-persistence | User preference for cleaner mental model: ship and test review-system as a focused feature; sort-persistence comes after as a self-contained follow-up. Trade: `due-first` is transient (resets on nav) until sort-persistence ships, but the bug is invisible to anyone not toggling the sort cycle. |
| 2026-04-27 | Q3: unified `ReviewStateBadge` | Spike confirmed one component for Locked/Due/Engraved is cleaner than splitting Engraved out. Replaces direct `EngravedIcon` use in `SwipeableVerseCard`. |
| 2026-04-27 | Q4: `DueCountPill` on collection card right side | Spike validated the pill fits between subtitle and chevron without crowding. No tab-icon badge in v1. |
| 2026-04-28 | Engraving is decoupled from the schedule (milestone only) | After audit re-read: engraving = passCount ≥ 10 cosmetic milestone. Algorithm runs identically before/after. No "freeze at cap on engraving." Simpler, one algorithm forever. |
| 2026-04-28 | In Progress threshold = lenient (any non-null bestAccuracy) | Matches existing `useInsightsStats` logic exactly so Library count = Insights count. No threshold drift. Drops earlier ≥50% Med/Hard idea. |
| 2026-04-28 | Settings UI = slider, range 30–365, default 90 | User preference. Min raised from 14 to 30 to avoid interfering with the day-1 to day-10 SR ladder during engraving. |
| 2026-04-28 | Reset wipes SR state including engraved status | User explicit choice to start over; honor the intent. Update Alert copy in setup/[id].tsx to be honest about what's wiped. |
| 2026-04-28 | Single canonical `DEFAULT_PROGRESS` + `parseProgress` helper | Three duplicates (storage, store, inline reset) caused silent shape drift. One source of truth, one helper consumed by all 5+ read-paths. |
| 2026-04-28 | Migration preserves `completed: true` for pre-engraved users | Seeds `passCount := 10` for pre-engraved rows so new client's `completed = passCount >= 10` derivation also returns true. Production blast radius is 0 today (no fully engraved users), but spec correctness matters. |
| 2026-04-28 | Type keeps `months?: string[]` optional through Chunk 1-3 | Required so `ProgressCard.tsx` (still reading legacy fields until Chunk 4) compiles. Removed only when cleanup migration drops the column. |
| 2026-04-28 | `useDueCounts` returns `{ mastered: number }` only | In Progress verses have no SR schedule and cannot be due; the audit-flagged `inProgress` count was dead weight. |
| 2026-04-28 | Reuse `ProgressInfoModal.tsx` (modify in place) | Audit flagged orphaning risk if a new `ReviewInfoModal` were added. Only consumer of the existing modal is `ProgressCard.tsx`; updating in place keeps file count low and removes dead-code risk. |
| 2026-04-28 | Legacy mastered-but-unscheduled rows render as Due | Post-migration `hard.completed && nextDueAt === null` rows: encourage user to review (which initializes SR) rather than show "no badge." |

## Graduation Checklist

- [ ] Schema changes reflected in `docs/architecture/data-model.md`
- [ ] Mastery / SR logic reflected in `docs/architecture/study-session.md`
- [ ] In Progress virtual collection reflected in `docs/architecture/library-and-collections.md`
- [ ] Engraving redefinition reflected in `docs/architecture/insights-and-streaks.md`
- [ ] AsyncStorage key + `clear()` exemption reflected in `docs/architecture/sync-and-storage.md`
- [ ] CLAUDE.md sharp-edge updated (engraving month-string-comparison → SR state)
- [ ] CLAUDE.md invariant #7 wording verified

## What Was Built

(Filled when shipped.)
