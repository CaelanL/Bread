# Feature: Review System (Spaced Repetition)

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Shipped:** —
>
> **Sibling doc:** `docs/features/notification-system.md` —
> notifications layer that consumes this system. Build review system
> first, ship it, let it bake, then plan notifications.

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
- [ ] User-settable max interval cap (range 14 to 365 days, default
      90). Stored client-side (AsyncStorage). Existing schedules are
      not retroactively recomputed when the user changes the cap;
      the new cap takes effect on the next successful review.
- [ ] New "In Progress" virtual collection (mirrors the Mastered
      virtual-collection pattern): verses with best score ≥ 50% on
      Medium *or* Hard AND `!hard.completed`, deduped by verse id.
      Stable signal — uses `bestAccuracy`, not last-attempt accuracy.
- [ ] Verse card shows a state badge: Locked (next review in N days)
      / Due (review now) / Engraved (lifetime: N reviews).
- [ ] Library list shows a count badge on Mastered + In Progress
      rows ("N due") when applicable.
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

UI-related questions (Q3, Q4, Q9) remain open pending mockup
iteration in-app. Other questions are resolved — see "Resolved
Decisions" below.

### Q1: Engraved threshold — what is N? *(RESOLVED — N=10)*

`passCount >= N` makes a verse engraved. With linear-day intervals
(1, 2, 3, 4… days), the *fastest* path to engraved is the triangular
sum of N: N=10 → 55 days, N=12 → 78 days, N=15 → 120 days, N=8 → 36
days.

**Resolved: A — N=10.** Matches the user-validated "about 2 months
at fastest" feeling; clean number for UI ("3 of 10 to engrave"). All
algorithm and copy in this doc assume `ENGRAVED_THRESHOLD = 10`.

### Q2: Default max-cap for review interval *(RESOLVED — 90 days, settings configurable 14–365)*

Default determines the post-engravement cadence the average user
gets without touching settings.

**Resolved: A — default 90 days.** Settings exposes a stepper /
slider with range 14–365. Constants:

```ts
DEFAULT_MAX_INTERVAL_DAYS = 90
MIN_USER_MAX_INTERVAL_DAYS = 14
MAX_USER_MAX_INTERVAL_DAYS = 365
```

### Q3: Badge component shape *(OPEN — pending UI mockup)*

Today `components/ui/EngravedIcon.tsx` is used inline in
`SwipeableVerseCard`. The new system needs Locked / Due / Engraved
states.

- **Option A — One unified `ReviewStateBadge` component** that
  switches state internally; replace direct `EngravedIcon` use with
  the new component. *(Cleaner, single source of truth.)*
- **Option B — Keep `EngravedIcon` for engraved state, add a separate
  `ReviewStateBadge` for Locked / Due.* *(Less refactor; two
  components doing related work.)*

### Q4: Where does the per-collection "due" count live? *(OPEN — pending UI mockup)*

Library page lists collections (Mastered, In Progress, user
collections). We want a count of "N due" somewhere visible.

- **Option A — Numeric pill on the Mastered + In Progress
  collection rows** ("Mastered · 3 due"). *(Discoverable, contextual.)*
- **Option B — Numeric badge on the Library tab icon itself** *(iOS
  app-icon-style. More noticeable, but pollutes tab nav.)*
- **Option C — Both**.

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

### Q9: Where does the due-verse pinning live inside Mastered / In Progress detail? *(OPEN — pending UI mockup)*

- **Option A — Pinned "Review now (N)" header section above the
  standard list.** Due verses appear *only* in the pinned section
  (not duplicated below). *(Clear visual separation.)*
- **Option B — Sort due verses to the top of the existing list with
  inline badges, no separate section.** *(Simpler; one list to
  maintain.)*
- **Option C — Pinned section AND verses also appear in the main
  list below.** *(Double-listing — feels redundant.)*

User chat lean: pinned section style. A.

### Q10: In Progress threshold — fixed or configurable? *(RESOLVED — hardcode 50%)*

**Resolved: A — hardcode 50%** on best Medium *or* Hard accuracy,
deduped by verse, excluding mastered verses. A short note
explaining "Why is this in In Progress?" surfaces somewhere in-app
(exact placement TBD during UI iteration).

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

**Migration SQL** (additive — Q7 Option B):

```sql
-- 014_review_state.sql
-- Add new SR fields to user_verses.progress.engraved while
-- preserving the legacy `months` array for cross-client safety
-- during the App Store rollout window. A follow-up migration drops
-- `months` once the new client is universally deployed (~2 weeks
-- after App Store release).
--
-- Resulting shape (post-migration, transition state):
--   {
--     completed:       boolean   (preserved from legacy)
--     months:          string[]  (preserved — legacy clients still read this)
--     passCount:       number    (new — seeded from months.length)
--     lifetimeReviews: number    (new — seeded from months.length)
--     nextDueAt:       null      (new — schedules fresh on next 90%-Hard session)
--     lastReviewedAt:  null      (new — no month-precision attempt timestamps to seed from)
--   }
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
        to_jsonb(COALESCE(jsonb_array_length(progress->'engraved'->'months'), 0))
      ),
      '{engraved,lifetimeReviews}',
      to_jsonb(COALESCE(jsonb_array_length(progress->'engraved'->'months'), 0))
    ),
    '{engraved,nextDueAt}',
    'null'::jsonb
  ),
  '{engraved,lastReviewedAt}',
  'null'::jsonb
)
WHERE progress ? 'engraved'
  AND NOT (progress->'engraved' ? 'passCount');  -- skip if already migrated

-- For rows with no `engraved` sub-object yet (older rows, never
-- engraved): left alone. Client default-progress shape will
-- populate them on next write. Both old and new clients tolerate
-- the absence of `engraved` (the type is already optional).
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
  let s = verse.progress.engraved (or default if missing)
  let isHard = (difficulty === 'hard')
  let isQualifying = isHard AND finalScore >= 90 AND fullSessionCompleted

  if NOT isQualifying:
    // No SR effect. Existing per-difficulty bestAccuracy logic
    // applies as today; SR state untouched.
    return verse.progress (unchanged engraved sub-object)

  // Qualifying review.

  if s.nextDueAt === null:
    // First mastery — initialize.
    s.passCount = 1
    s.lifetimeReviews = 1
    s.lastReviewedAt = now()
    let intervalDays = min(s.passCount, userMaxIntervalDays)
    s.nextDueAt = midnightLocal(now() + intervalDays days)
    s.completed = (s.passCount >= ENGRAVED_THRESHOLD)
    return s

  if now() < s.nextDueAt:
    // Locked (early). Lifetime ticks; schedule and passCount untouched.
    s.lifetimeReviews += 1
    s.lastReviewedAt = now()
    return s

  // On-time or overdue.
  s.passCount += 1
  s.lifetimeReviews += 1
  s.lastReviewedAt = now()
  let intervalDays = min(s.passCount, userMaxIntervalDays)
  s.nextDueAt = midnightLocal(now() + intervalDays days)
  s.completed = (s.passCount >= ENGRAVED_THRESHOLD)
  return s
```

`midnightLocal(d)` returns ISO timestamp of local midnight at the
start of date `d`. Helper in `lib/store/review.ts`:

```ts
function midnightLocal(d: Date): string {
  const local = new Date(d);
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}
```

(Resolution of Q5: this is local-midnight; user-timezone-relative.
A user who travels and then completes a review will get the new
timezone's midnight, which matches what `get_current_streak` does.)

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
entirely client-side off the in-memory verse list.

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
  Locked / Due / Engraved per `useReviewState(verseId)`.
- `components/library/DueCountPill.tsx` — small "N due" pill.
- `components/library/ReviewSection.tsx` — pinned "Review now (N)"
  list section.
- `components/ui/ReviewInfoModal.tsx` — info modal explaining the
  system.

**Files modified**:

- `lib/storage/index.ts` —
  - Update `EngravedProgress` type to new shape (add `passCount`,
    `lifetimeReviews`, `nextDueAt`, `lastReviewedAt`; remove
    `months`).
  - Update `DEFAULT_PROGRESS` to seed the new fields with `0` /
    `null`.
  - Keep `engraved?:` optional so older in-memory rows that haven't
    been touched yet don't crash on read.
- `lib/store/index.ts` —
  - Refactor `updateVerseProgress` to call `computeNextSrState`
    instead of inline month logic.
  - Remove `isConsecutiveMonth` helper (no longer used).
  - Add `IN_PROGRESS_COLLECTION_ID = 'in-progress'` constant.
  - Add `IN_PROGRESS_COLLECTION` virtual collection (mirrors
    `MASTERED_COLLECTION`).
  - Add selectors:
    - `useInProgressVerses()` → dedup by id, filter:
      `(medium.bestAccuracy >= 50 || hard.bestAccuracy >= 50)
      && !hard.completed`.
    - `useReviewState(verseId)` → `'pre-mastery' | 'locked' | 'due'
      | 'engraved'`.
    - `useDueCounts()` → `{ mastered: number, inProgress: number }`.
  - Add `reviewMaxIntervalDays` to state (default
    `DEFAULT_MAX_INTERVAL_DAYS`), action `setReviewMaxIntervalDays`,
    AsyncStorage key `review_max_interval_days`.
  - `clear()` exempts `reviewMaxIntervalDays` (device pref like
    `colorMode`).
  - Hydrate loads `reviewMaxIntervalDays` from AsyncStorage
    alongside `colorMode`/`bibleVersion`.
- `lib/storage/index.ts` `getCollections()` — emit the In Progress
  virtual collection like Mastered.
- `app/(tabs)/(library)/index.tsx` — render In Progress collection
  in the list when `useInProgressVerses().length > 0`. Add
  `<DueCountPill>` to Mastered + In Progress rows.
- `app/(tabs)/(library)/[id].tsx` — when collection id is
  `MASTERED_COLLECTION_ID` or `IN_PROGRESS_COLLECTION_ID`, render
  `<ReviewSection>` above the standard verse list when there are
  due verses.
- `components/library/SwipeableVerseCard.tsx` —
  - Replace the direct `EngravedIcon` use with
    `<ReviewStateBadge>`.
  - Keep the gold-glow-when-engraved styling (read from
    `progress.engraved.completed` — same field name, new
    semantics).
- `app/(tabs)/settings.tsx` — add "Review System" section:
  - Stepper / slider: max review interval days
    (`MIN_USER_MAX_INTERVAL_DAYS` to `MAX_USER_MAX_INTERVAL_DAYS`,
    default `DEFAULT_MAX_INTERVAL_DAYS`).
  - "How does this work?" link → opens `<ReviewInfoModal>`.

**Files removed**: none. (The legacy `isConsecutiveMonth` helper in
`lib/store/index.ts` will be removed inline in the same edit, not
as a separate file deletion.)

### State changes

| State | Owner | Persisted |
|---|---|---|
| `reviewMaxIntervalDays: number` | Zustand + AsyncStorage (`review_max_interval_days`) | Yes |

`clear()` exempts this — it's a device pref, not user data.
Mirrors the `colorMode` / `bibleVersion` pattern.

The new `EngravedProgress` shape is part of `progress` JSONB, so it
syncs through the existing pipeline. No new sync surface.

### UI

**`ReviewStateBadge`** has three visual states:

| State | Trigger | Visual |
|---|---|---|
| pre-mastery | `!hard.completed` | (no badge — verse hasn't entered SR yet) |
| Locked | `hard.completed && now < nextDueAt` | Muted neutral chip, text "Next review in 3d" / "tomorrow" / etc. |
| Due | `hard.completed && now >= nextDueAt` | Accent (`colors.tint`) chip, text "Review now". (Pulse animation = nice-to-have.) |
| Engraved | `engraved.completed` | Existing `EngravedIcon` + lifetime count text "47 reviews"; gold tint. |

When a verse is both Engraved and Due (engraved verses still get
maintenance reviews), the Engraved variant wins for the icon, and
the Due indicator surfaces as the row sort order + the "Review
now" pinned section. (The badge isn't trying to convey both states;
it shows engraved status with the lifetime number.)

**`DueCountPill`** — small rounded pill, `colors.tint` background,
white text, 12px. "3 due" / "1 due". Hidden when count = 0.

**`ReviewSection`** — pinned list header with `cardAlt` background:

```
┌─ Review now (3) ────────────────────┐
│  [Verse card 1] [Due]               │
│  [Verse card 2] [Due]               │
│  [Verse card 3] [Due]               │
└─────────────────────────────────────┘
[regular Mastered list below]
```

Tapping a card in the section opens the standard pre-session
difficulty/chunk-size picker (`/setup/[id]`), same as elsewhere.

**`ReviewInfoModal`** — three sentences. No animation.

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

### Chunk 1 — Migration + types + pure SR logic

Branch: `review-1-data-and-logic`

Goal: schema migrated, types updated, pure-function SR logic exists
with unit tests. **No UI changes; no scheduling.** The new fields
are written by the existing `updateVerseProgress` path but nothing
yet reads them visually.

Files:
- `supabase/migrations/014_review_state.sql` — migration above.
- `lib/storage/index.ts` — update `EngravedProgress` type and
  `DEFAULT_PROGRESS` shape. Keep `engraved?:` optionality.
- `lib/store/review-config.ts` — constants.
- `lib/store/review.ts` — pure helpers + unit tests in
  `lib/store/__tests__/review.test.ts` (or co-located).
- `lib/store/index.ts` — refactor `updateVerseProgress` to call
  `computeNextSrState`; remove `isConsecutiveMonth`.

Validation:
- `npx tsc --noEmit` clean; `npm run lint` clean.
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
- `lib/store/index.ts` —
  - `IN_PROGRESS_COLLECTION_ID`, `IN_PROGRESS_COLLECTION`.
  - Selectors: `useInProgressVerses`, `useReviewState`,
    `useDueCounts`.
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
- `components/library/ReviewStateBadge.tsx` — new.
- `components/library/DueCountPill.tsx` — new.
- `components/library/SwipeableVerseCard.tsx` — wire badge in;
  remove direct `EngravedIcon` (unless Q3 = B).
- `app/(tabs)/(library)/index.tsx` — pills on Mastered + In Progress
  rows.

Validation: device test — badges show correct state for each
verse; pills update in real time after a session.

### Chunk 4 — Pinned "Review now" section

Branch: `review-4-pinned-section`

Goal: due verses surface prominently inside Mastered / In Progress
detail.

Files:
- `components/library/ReviewSection.tsx` — new.
- `app/(tabs)/(library)/[id].tsx` — render `<ReviewSection>`
  conditionally above the list.
- (Optional nice-to-have) "Review all due" button at section
  bottom.

### Chunk 5 — Settings cap + info modal

Branch: `review-5-settings`

Goal: user can tune max interval and learn how the system works.

Files:
- `lib/store/index.ts` — `reviewMaxIntervalDays` state, action,
  AsyncStorage hydration / persistence, `clear()` exemption.
- `app/(tabs)/settings.tsx` — Review System section (stepper or
  slider) and "How does this work?" link.
- `components/ui/ReviewInfoModal.tsx` — new.

Validation: device test — change the cap, complete a review,
verify next interval respects cap.

### Chunk 6 — Doc graduation

Files:
- `docs/architecture/data-model.md` — update `progress` JSONB shape
  in the `user_verses` section to reflect the new
  `engraved` sub-object.
- `docs/architecture/study-session.md` — update mastery progression
  step 8 to reference `lib/store/review.ts`.
- `docs/architecture/library-and-collections.md` — document the In
  Progress virtual collection alongside Mastered.
- `docs/architecture/insights-and-streaks.md` — note that engraved
  is now derived from `passCount`, not month streaks.
- `docs/architecture/sync-and-storage.md` — note new AsyncStorage
  key (`review_max_interval_days`) and `clear()` exemption.
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
