# Data Model

> **Status: Living document.** Update when migrations are added or
> RLS policies change. Read before touching `supabase/migrations/`,
> `lib/storage/`, `lib/sync/`, or anything that calls Supabase
> directly.

The schema lives in `supabase/migrations/` (numbered sequentially,
001–013). The migrations are the source of truth — this doc explains
the shape and the *why*.

## Tables overview

| Table | Owner | Purpose |
|---|---|---|
| `usage_daily` | per-user | Free/Supporter rate-limit counters (transcribe seconds, evaluate count, Bible fetch count) |
| `transcription_locks` | per-user | Server-side mutex to block double-tapped recordings (5-min TTL) |
| `subscriptions` | per-user | Tier (`free` \| `supporter`) with optional expiry |
| `verse_cache` | shared | Server-side Bible text cache, max 500 verses per version, LRU evicted (licensing) |
| `user_collections` | per-user | User's collections, soft-deletable, identified by `(user_id, client_id)` |
| `user_verses` | per-user | Verse references — book/chapter/verse_start/verse_end/version + `progress` JSONB. **No text column.** |
| `verse_collections` | per-user (via verse) | Many-to-many junction: `(verse_id, collection_id)` |
| `verse_of_month` | global | Public monthly challenge verse, optional `image_url` |
| `session_attempts` | per-user, append-only | One row per practice session (or partial early exit). Denormalized — no FK to `user_verses`. |
| `user_stats` | per-user | Cron-precomputed: `total_words_mastered`, `avg_time_per_word_ms`. Only populated for users with 600+ words mastered. |
| `popular_ranges` | global | Cron-aggregated top 1000 verse ranges across all users |

`chapter_cache` (migration 003) was deprecated by migration 004's
verse-level cache. The table may still exist; nothing reads from it.

## Per-table detail

### `user_collections`

Migration: `002_user_data.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | server-generated |
| `user_id` | UUID FK → `auth.users` | CASCADE on delete |
| `client_id` | TEXT | client-generated; unique per `(user_id, client_id)` |
| `name` | TEXT | |
| `is_default` | BOOLEAN | `true` for the auto-created "My Verses" collection |
| `deleted_at` | TIMESTAMPTZ | soft delete; NULL = active |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-updated by trigger `update_user_collections_updated_at` |

Indexes:
- `idx_user_collections_user (user_id) WHERE deleted_at IS NULL` — active-collection lookups
- `idx_user_collections_client (user_id, client_id)` — upserts by client_id

RLS: SELECT/INSERT/UPDATE where `auth.uid() = user_id`. Service role
all.

### `user_verses`

Migration: `002_user_data.sql` (created), `005_user_verses_no_text.sql`
(text column dropped)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `auth.users` | |
| `client_id` | TEXT | unique per `(user_id, client_id)` |
| `book` | TEXT | canonical name e.g. `"John"`, `"Psalms"` (not `"Psalm"`) |
| `chapter` | INT | |
| `verse_start` | INT | |
| `verse_end` | INT | equal to `verse_start` for single verses |
| `version` | TEXT | `ESV` \| `KJV` \| `NLT` \| `NIV` \| `NKJV` |
| `progress` | JSONB | shape below |
| `deleted_at` | TIMESTAMPTZ | soft delete |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-updated |

**Critical: no `text` column.** Verse text lives only in `verse_cache`
(or the in-memory session cache). This is a licensing requirement —
do not re-add a text column.

Indexes:
- `idx_user_verses_user (user_id) WHERE deleted_at IS NULL`
- `idx_user_verses_client (user_id, client_id)`
- `idx_user_verses_unique_verse (user_id, book, chapter, verse_start, verse_end, version) WHERE deleted_at IS NULL`
  — prevents adding the same verse twice while it's active

`progress` JSONB shape (canonical default in `lib/storage/index.ts`):

```ts
{
  easy:     { bestAccuracy: number | null, completed: boolean },
  medium:   { bestAccuracy: number | null, completed: boolean },
  hard:     { bestAccuracy: number | null, completed: boolean },
  engraved: {
    completed:       boolean,           // passCount >= 10 (sticky)
    passCount:       number,            // monotonic; advances per on-time review
    lifetimeReviews: number,            // includes early/locked qualifying reviews
    nextDueAt:       string | null,     // ISO UTC; review time = lastReviewedAt + N*24h
    lastReviewedAt:  string | null,     // ISO UTC of last qualifying session
    months?:         string[]           // legacy; preserved during App Store rollout
  }
}
```

`completed` (per-difficulty) flips to `true` when `bestAccuracy >= 90`.

The `engraved` sub-object holds spaced-repetition state. The schedule
is `nextDueAt = now + min(passCount, userMaxIntervalDays) * 24h` —
i.e. the review interval is exactly N×24h from completion, not aligned
to local midnight. A qualifying review (Hard, ≥ 90%, full session) on
or after `nextDueAt` advances `passCount` and reschedules.
`engraved.completed = true` once `passCount >= 10` and is permanent.
See `lib/store/review.ts` for the algorithm and
`docs/features/review-system.md` for the why.

The legacy `months: string[]` array is preserved by migration 014 for
cross-client safety during the App Store rollout window — old clients
still write it, the new client read-fallbacks from it
(`passCount := months?.length ?? 0`) but never writes it. A follow-up
cleanup migration drops it once all live clients have updated.

### `verse_collections`

Migration: `006_verse_collections_junction.sql` (introduced — replaces
the original `collection_id` column on `user_verses`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `verse_id` | UUID FK → `user_verses` | ON DELETE CASCADE |
| `collection_id` | UUID FK → `user_collections` | ON DELETE CASCADE |
| `added_at` | TIMESTAMPTZ | |

Unique: `(verse_id, collection_id)`. Indexes on both FKs.

RLS: SELECT/INSERT/DELETE allowed only when the requester owns the
verse. The policy uses an `EXISTS` subquery against
`user_verses.user_id`.

A verse can live in any number of collections. Removing a verse from
the *last* collection it belongs to triggers either a soft-delete
(if mastered) or a hard-delete (if not), in `lib/storage/index.ts`.

### `verse_cache`

Migration: `004_verse_level_cache.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `book` | TEXT | |
| `chapter` | INT | |
| `verse` | INT | |
| `version` | TEXT | |
| `text` | TEXT | the actual verse text |
| `last_used_at` | TIMESTAMPTZ | bumped on every read for LRU |
| `created_at` | TIMESTAMPTZ | |

Unique: `(book, chapter, verse, version)`. Indexes:
- `idx_verse_cache_chapter (book, chapter, version)`
- `idx_verse_cache_lru (version, last_used_at)`
- `idx_verse_cache_version (version)`

**RLS is intentionally disabled.** This is a server-side shared
cache, not user data. Public-API access *should* be revoked
(see `docs/operations/security-todo.md`) so that anon/authenticated
roles can't query it directly — the edge function uses the service
role to access it.

Capped at 500 rows per version (ESV/NLT licensing); LRU eviction
triggers on insert via `evict_lru_verses(version, max_count, needed)`.

Functions:
- `get_verse_cache_count(version)` → row count for a version
- `evict_lru_verses(version, max_count, needed)` → deletes oldest
- `upsert_verses(book, chapter, version, jsonb)` → bulk upsert,
  bumps `last_used_at` on conflict
- View `verse_cache_stats` → per-version count + min/max
  `last_used_at`

### `session_attempts`

Migration: `009_session_attempts.sql`, `012_analytics_functions.sql.done`
(adds `word_count`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `auth.users` | no CASCADE — deletion handled by `delete_own_account()` |
| `book` | TEXT | denormalized snapshot |
| `chapter` | INT | |
| `verse_start` | INT | |
| `verse_end` | INT | |
| `version` | TEXT | |
| `difficulty` | TEXT | `easy` \| `medium` \| `hard` |
| `chunk_size` | INT | how the session was split |
| `accuracy` | DECIMAL | final session score (0–100) |
| `recording_duration_ms` | INT | nullable; sum of all chunk recordings |
| `word_count` | INT | nullable; verse word count at attempt time |
| `created_at` | TIMESTAMPTZ | |

Indexes:
- `idx_session_attempts_user_date (user_id, created_at DESC)` — recent
  activity, streaks
- `idx_session_attempts_user_difficulty (user_id, difficulty, created_at DESC)`
- `idx_session_attempts_verse (user_id, book, chapter, verse_start, verse_end)`

RLS: SELECT/INSERT where `auth.uid() = user_id`. **No UPDATE, no
DELETE policy** — the table is append-only by design. Deletion only
happens via `delete_own_account()` (service role).

**No FK to `user_verses`.** Attempts survive verse deletion, which
is what makes long-term analytics (avg time to master, popular
ranges) work even after a user removes a verse.

### `usage_daily`, `transcription_locks`, `subscriptions`

`usage_daily` (migration 001): per-user per-day counters used by the
edge function rate limiter. Unique on `(user_id, date)`. Each
`bible_fetch_count` increment counts against the user's tier limit
(Free: 100/day, Supporter: 10,000/day — see
`docs/architecture/bible-api-and-caching.md`).

`transcription_locks` (migration 001): a server-side mutex keyed by
`user_id`. The recording edge function inserts a row on entry and
deletes on exit. `cleanup_stale_transcription_locks()` deletes locks
older than 5 minutes. Service role only; users can't read or modify.

`subscriptions` (migration 001): one row per user. `tier` is `free` or
`supporter`. `expires_at` is nullable (never-expires when NULL). Read
by the edge function via `getUserTier()` to apply rate limits.

### `verse_of_month`, `popular_ranges`, `user_stats`

`verse_of_month` (migrations 007, 008): Public-readable monthly
challenge. Schema: `id`, `year_month` (TEXT, format `"YYYY-MM"`,
unique), `book`, `chapter`, `verse_start`, `verse_end`, `image_url`
(nullable, optional cover image). Inserted by admin via Supabase
dashboard or service role.

`popular_ranges` (migration 010): Top verse ranges across all users,
refreshed every 12 hours by `update_popular_ranges()`. Generates
*every* sub-range from `user_verses` using `generate_series` —
counts distinct users per `(book, chapter, start, end)`. Includes
soft-deleted verses (intentional — see migration comment).
Public-readable; service role writes.

`user_stats` (migration 011): Cron-precomputed every 6 hours by
`update_user_stats()`. Computes `total_words_mastered` and
`avg_time_per_word_ms` only for users who already have 600+ words
mastered (so the "average time to master" insight is null for most
users). Not populated incrementally — the cron is the only writer.

## Functions and triggers

| Name | Type | Purpose |
|---|---|---|
| `update_updated_at_column()` | trigger fn | sets `updated_at = NOW()` |
| `update_user_collections_updated_at` | trigger | fires on UPDATE |
| `update_user_verses_updated_at` | trigger | fires on UPDATE |
| `cleanup_stale_transcription_locks()` | fn | deletes locks > 5 min old |
| `get_verse_cache_count(version)` | fn | row count per version |
| `evict_lru_verses(version, max, needed)` | fn | LRU eviction batch |
| `upsert_verses(book, chapter, version, jsonb)` | fn | bulk verse upsert |
| `get_total_time_studied(user_id)` | fn (SECURITY DEFINER) | sums `recording_duration_ms` |
| `get_current_streak(user_id, tz_offset_min)` | fn (SECURITY DEFINER) | counts consecutive practice days in user's TZ |
| `update_popular_ranges()` | fn (SECURITY DEFINER, cron 12h) | rebuilds `popular_ranges` |
| `update_user_stats()` | fn (SECURITY DEFINER, cron 6h) | refreshes `user_stats` for users ≥600 words mastered |
| `delete_own_account()` | fn (SECURITY DEFINER) | cascades user deletion across all tables in safe order |
| `get_votm_mastery_count(book, chapter, vs, ve)` | **MISSING** | client calls it, no migration defines it — will throw at runtime |

## Relationships

```
auth.users
 ├── user_collections (soft-delete)
 │     └── verse_collections (junction) ─── user_verses (soft-delete, no text)
 │                                               │
 │                                               └── (references) verse_cache (shared, LRU)
 ├── session_attempts (append-only, denormalized — no FK to user_verses)
 ├── user_stats (cron-computed)
 ├── usage_daily
 ├── transcription_locks
 └── subscriptions

verse_of_month   (public read, admin write)
popular_ranges   (public read, cron write — derived from user_verses)
```

## Soft-delete semantics

Soft delete is asymmetric and intentional:

- **`user_collections`**: soft-deleted (`deleted_at IS NOT NULL`).
  The "My Verses" default collection cannot be deleted at all
  (client guard in `SwipeableCollectionCard`, store guard in
  `deleteCollection`).
- **`user_verses`**:
  - If the verse is mastered (`progress.hard.completed === true`),
    soft-delete so it stays visible in the virtual `@mastered`
    collection.
  - If not mastered AND not in any other collection, hard-delete.
  - If still in another collection, just remove the junction row
    (the verse remains active in the other collection).
- **`session_attempts`**: never deleted. Only `delete_own_account()`
  removes them.

The unique index on `user_verses` is partial (`WHERE deleted_at IS
NULL`), which means: re-adding a soft-deleted verse creates a
*second* row. The original soft-deleted row stays for the Mastered
list. Restoration of a soft-deleted verse is handled in
`lib/storage/index.ts` — it un-soft-deletes the existing row instead
of inserting a new one.

## Migration tooling

- Migrations live in `supabase/migrations/`, numbered like
  `NNN_name.sql`. Add new ones with the next number.
- `supabase migration new <name>` creates a numbered file.
- `supabase db push` applies pending migrations to the linked
  remote project. `supabase migration up` for local.
- `.done` suffix (`012_analytics_functions.sql.done`) is unusual —
  treat it as applied. Don't re-run by removing the suffix.

## Sharp edges

- `get_votm_mastery_count` is called from `lib/api/votm.ts` but no
  migration defines it. Add the function before depending on the
  count.
- The edge function uses the **service role key** to bypass RLS for
  `verse_cache` and `usage_daily`. Don't ever ship that key to the
  client.
- Public-API access to `verse_cache`, `app_config`, and the
  `verse_cache_stats` view should be revoked
  (see `docs/operations/security-todo.md`). Until then, the anon
  key can read these tables.
- Function `search_path` is unset on most functions — flagged by
  Supabase Security Advisor (low risk; tracked in security-todo).
- `update_popular_ranges()` includes soft-deleted verses on purpose,
  so a deleted verse continues inflating popularity until the next
  12-hour cron tick.
- `popular_ranges` enumerates *every* sub-range with
  `generate_series` — table size grows fast. Top 1000 only retained.
