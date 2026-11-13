# Data Model

Schema: `supabase/migrations/`. Generated columns and types:
`supabase/database.types.ts`.

## Tables overview

| Table | Owner | Purpose |
|---|---|---|
| `profiles` | per-user | account `translation` (`bible-versions.md`), names ([auth](auth.md#display-name)) |
| `usage_daily` | per-user | Free/Supporter rate-limit counters (transcribe seconds, evaluate count, Bible fetch count) |
| `transcription_locks` | per-user | Unused server-side mutex (see below) |
| `subscriptions` | per-user | Tier (`free` \| `supporter`) with optional expiry |
| `verse_cache` | shared | Server-side Bible text cache under ESV/NLT licensing limits, see `docs/architecture/bible-api-and-caching.md` |
| `app_config` | shared | Key/value settings for the stats cron (`stats_min_words`, `stats_cron_schedule`) |
| `user_collections` | per-user | Editable, soft-deleted; IDs unique per user |
| `curated_collection_savers` | global | [All-time contribution ledger and access rules](../features/home.md#community-saves) |
| `user_verses` | per-user | Verse references — book/chapter/verse_start/verse_end/version + `progress` JSONB. **No text column.** |
| `verse_collections` | per-user (via verse) | Many-to-many junction: `(verse_id, collection_id)` |
| `shared_collections`, `shared_collection_members`, `shared_collection_verses`, `shared_invites` | per-group | [Shared collections](../features/shared-collections.md#data-model), references only |
| `invite_handoffs` | server | [Handoff](navigation-and-routing.md#invite-handoff) |
| `verse_of_month` | global | Public monthly challenge verse, optional `image_url` |
| `user_intro_presentations` | per-user | [Intro claims](../features/home.md#encouragement-video) |
| `session_attempts` | per-user, append-only | One row per practice session (or partial early exit). Denormalized — no FK to `user_verses`. |
| `user_stats` | per-user | Cron-precomputed: `total_words_mastered`, and `avg_time_per_word_ms` for users with 600+ words mastered. |
| `popular_ranges` | global | Cron-aggregated top 1000 mastered verse ranges across all users |
| `device_tokens` | per-user | Expo push tokens |
| `notification_preferences` | per-user | Reminder settings and per-day fired markers |
| `notification_log` | per-user | Send log, pruned after 30 days |

Notification tables are covered in `docs/features/notifications.md`.

`chapter_cache` (migration 003) and the first, reference-keyed
`verse_cache` (migration 001) were dropped by migration 004.

## Per-table detail

### `user_collections`

Migrations: `002_user_data.sql`, `016_sort_and_last_practiced.sql`,
`20261110152251_collection_management.sql`.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID FK → `auth.users` | CASCADE on delete |
| `client_id` | TEXT | client-generated; unique per `(user_id, client_id)` |
| `name` | TEXT | |
| `is_default` | BOOLEAN | `true` for the auto-created "My Verses" collection |
| `sort_preference` | TEXT | nullable; `recent` \| `alphabetical` \| `mastery` \| `due-first`; NULL = default |
| `icon_key` | TEXT | nullable |
| `position` | INTEGER | custom order, nullable |
| `shared_collection_id` | UUID FK → `shared_collections` | nullable, SET NULL on delete, no client writes ([why](../features/shared-collections.md#access-rules)) |
| `deleted_at` | TIMESTAMPTZ | soft delete; NULL = active |
| `updated_at` | TIMESTAMPTZ | trigger maintained |

Indexes:
- `idx_user_collections_user (user_id) WHERE deleted_at IS NULL` — active-collection lookups
- `idx_user_collections_client (user_id, client_id)` — lookups by client_id

RLS: owner SELECT/INSERT/UPDATE/DELETE, service all. Insert and update are
column grants: grant each new column.

### `user_verses`

Migration: `002_user_data.sql` (created), `005_user_verses_no_text.sql`
(text column dropped), `016_sort_and_last_practiced.sql`
(`last_practiced_at`), `021_verse_study_prefs.sql` (`last_chunk_size`,
`last_difficulty`)

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID FK → `auth.users` | |
| `client_id` | TEXT | unique per `(user_id, client_id)` |
| `book` | TEXT | canonical name e.g. `"John"`, `"Psalms"` (not `"Psalm"`) |
| `chapter`, `verse_start` | INT | |
| `verse_end` | INT | equal to `verse_start` for single verses |
| `version` | TEXT | short uppercase version code, from the account translation |
| `progress` | JSONB | shape below |
| `last_practiced_at` | TIMESTAMPTZ | nullable; last session, full or partial, any difficulty; cleared on progress reset |
| `last_chunk_size` | INT | nullable; last chunk size chosen on the setup screen |
| `last_difficulty` | TEXT | nullable; `easy` \| `medium` \| `hard`; last difficulty chosen on the setup screen |
| `deleted_at` | TIMESTAMPTZ | soft delete |
| `updated_at` | TIMESTAMPTZ | auto-updated |

**Critical: no `text` column.** See invariant 2 in
`docs/architecture/bible-api-and-caching.md`.

Indexes:
- `idx_user_verses_user (user_id) WHERE deleted_at IS NULL`
- `idx_user_verses_client (user_id, client_id)`
- `idx_user_verses_unique_verse (user_id, book, chapter, verse_start, verse_end, version) WHERE deleted_at IS NULL`
  — per version; the client keeps one row per reference (`bible-versions.md`)

`progress` JSONB shape (canonical default is `DEFAULT_PROGRESS` in
`lib/storage/index.ts`):

```ts
{
  easy:     { bestAccuracy: number | null, completed: boolean },
  medium:   { bestAccuracy: number | null, completed: boolean },
  hard:     { bestAccuracy: number | null, completed: boolean },
  engraved: {
    completed:       boolean,           // passCount >= 10 (sticky)
    passCount:       number,            // monotonic; advances per due review, on-time or overdue
    lifetimeReviews: number,            // includes early/locked qualifying reviews
    nextDueAt:       string | null,     // ISO UTC
    lastReviewedAt:  string | null,     // ISO UTC of last qualifying session
    months?:         string[]           // legacy, see below
  }
}
```

`completed` (per-difficulty) flips to `true` when `bestAccuracy >= 90`.

The `engraved` sub-object holds spaced-repetition state. See
`lib/store/review.ts` for the algorithm and `docs/features/review.md`
for the rules.

The legacy `months` array is covered in
[review.md](../features/review.md#legacy-months).

**Study prefs** (`last_chunk_size`, `last_difficulty`, migration 021): see
[study-session.md](../features/study-session.md#remembered-prefs).

### `verse_collections`

Migration `006_verse_collections_junction.sql` replaces `user_verses.collection_id`.

`verse_id` and `collection_id` are FKs with ON DELETE CASCADE, plus
`added_at`.

Unique: `(verse_id, collection_id)`. Indexes on both FKs.

RLS uses `EXISTS` on `user_verses.user_id` to require verse ownership for reads, inserts and deletes.

A verse can be in many collections; see `delete_verse` for leaving the last.

### `verse_cache`

Migration: `004_verse_level_cache.sql`

One row per verse: `book`, `chapter`, `verse`, `version`, `text` (the
actual verse text), and `last_used_at`, bumped on every read for LRU.

Unique: `(book, chapter, verse, version)`. Indexed for chapter lookups,
LRU and per-version counts.

**Locked to the service role.** Migration 020 turned RLS on with no
policies and revoked `anon` and `authenticated`, the same for
`app_config` and the `verse_cache_stats` view (now `security_invoker`).
Edge functions reach them with the service role, which bypasses both.

Licensing limits, eviction and its known gaps are in
`docs/architecture/bible-api-and-caching.md`.

The edge function calls none of the cache SQL helpers in the table below.

`getCacheStats` in `cache.ts` reads the view `verse_cache_stats`
(per-version count + min/max `last_used_at`).

### `session_attempts`

Migration: `009_session_attempts.sql`, `010_add_word_count.sql`
(`word_count`)

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID FK → `auth.users` | no CASCADE — deletion handled by `delete_own_account()` |
| `book`, `chapter`, `verse_start`, `verse_end`, `version` | | denormalized snapshot |
| `difficulty` | TEXT | `easy` \| `medium` \| `hard` |
| `chunk_size` | INT | how the session was split |
| `accuracy` | DECIMAL | final session score (0–100) |
| `recording_duration_ms` | INT | nullable; sum of all chunk recordings |
| `word_count` | INT | nullable; verse word count at attempt time |

Indexes:
- `idx_session_attempts_user_date (user_id, created_at DESC)` — recent
  activity, streaks
- `idx_session_attempts_user_difficulty (user_id, difficulty, created_at DESC)`
- `idx_session_attempts_verse (user_id, book, chapter, verse_start, verse_end)`

RLS: SELECT/INSERT where `auth.uid() = user_id`. **No UPDATE, no
DELETE policy** — the table is append-only by design. Deletion only
happens via `delete_own_account()` (`SECURITY DEFINER`).

**No FK to `user_verses`.** See Decisions.

### `usage_daily`, `transcription_locks`, `subscriptions`

`usage_daily` (migration 001): per-user per-day counters used by the
edge function rate limiter. Unique on `(user_id, date)`. Each
`bible_fetch_count` increment counts against the user's tier limit
(see `docs/architecture/edge-functions.md`).

`transcription_locks` (migration 001): a mutex keyed by `user_id`,
service role only. No code acquires a lock, so the table stays empty.
`cleanup_stale_transcription_locks()` deletes locks older than 5
minutes.

`subscriptions` (migration 001): one row per user. `tier` is `free` or
`supporter`. `expires_at` is nullable (never-expires when NULL). Read
by the edge function via `getUserTier()` to apply rate limits.

### `verse_of_month`, `popular_ranges`, `user_stats`

`verse_of_month`: [monthly references, public-bucket artwork and access rules](../features/home.md#verse_of_month).

`popular_ranges` (migrations `0101_popular_verses.sql`,
`015_popular_verses_mastered_only.sql`): Top verse ranges across all
users, refreshed every 12 hours by `update_popular_ranges()`. Generates
*every* sub-range of each mastered verse using `generate_series` —
counts distinct users per `(book, chapter, start, end)`.
Public-readable; service role writes. See `docs/features/insights.md`.

`user_stats` (migration 011): Cron-precomputed every 6 hours by
`update_user_stats()`. Computes `total_words_mastered` for every user
with a qualifying attempt, once per reference, and `avg_time_per_word_ms` only for users
with `stats_min_words` (600) or more mastered words. So the "average
time to master" insight is null for most users. Not populated
incrementally — the cron is the only writer.

## Functions, triggers and cron

| Name | Type | Purpose |
|---|---|---|
| `update_updated_at_column()` | trigger fn | sets `updated_at = NOW()` |
| `update_user_collections_updated_at` | trigger | fires on UPDATE |
| `update_user_verses_updated_at` | trigger | fires on UPDATE |
| `cleanup_stale_transcription_locks()` | fn | deletes locks > 5 min old |
| `cleanup_expired_verse_cache()` | fn | unused since migration 001, references a dropped column |
| `get_verse_cache_count(version)` | fn | row count per version |
| `evict_lru_verses(version, max, needed)` | fn | LRU eviction batch |
| `upsert_verses(book, chapter, version, jsonb)` | fn | bulk verse upsert |
| `import_curated_collection()` | authenticated invoker | atomic Library import |
| `claim_intro_presentation(text)` | authenticated invoker | one account claim |
| `get_total_time_studied(user_id)` | fn (SECURITY DEFINER) | sums `recording_duration_ms` |
| `get_current_streak(user_id, tz_offset_min)` | fn (SECURITY DEFINER) | counts consecutive practice days in user's TZ |
| `update_popular_ranges()` | fn (SECURITY DEFINER) | rebuilds `popular_ranges` |
| `update_user_stats()` | fn (SECURITY DEFINER) | refreshes `user_stats` |
| `delete_own_account()` | fn (SECURITY DEFINER) | safely orders account deletion across tables |
| `register_device_token(token, platform)` | fn (SECURITY DEFINER) | assigns token to caller, including reassignment. See `docs/features/notifications.md` |
| `reorder_collections` | invoker, authenticated only | saves full custom order atomically |
| `copy_verse_to_collection` | invoker, authenticated only | checks both owners (junction INSERT RLS checks only the verse owner) |
| `add_verse`, `delete_verse`, `delete_collection` | invoker, signed in | [add](../features/adding-verses.md#verse-identity), [delete](../features/library.md#deleting-a-verse) |
| shared collection functions | invoker wrappers | [table](../features/shared-collections.md#functions) |
| `get_cron_secret()` | fn (SECURITY DEFINER), service role only | reads `cron_secret` from Vault |
| `local_time_in_tz(tz)` | fn | local time in an IANA zone, UTC if the name is unknown |
| `verse_cache_stats` | view | per-version cache stats |
| `get_votm_mastery_count(book, chapter, vs, ve)` | **MISSING** | see `docs/features/home.md` |

`pg_cron` jobs: `update-popular-ranges` (every 12h), `update-user-stats`
(every 6h), `send-notifications` (every minute, through `pg_net`) and
`prune-notification-log` (daily).

## Relationships

```
auth.users
 ├── profiles (account translation, display name)
 ├── shared_collections ── members, verses (references), invites
 ├── user_collections (soft-delete; shared_collection_id → shared_collections)
 │     └── verse_collections (junction) ─── user_verses (soft-delete, no text)
 │                                               │
 │                                               └── (references) verse_cache (shared, LRU)
 ├── session_attempts (append-only, denormalized — no FK to user_verses)
 ├── user_stats (cron-computed)
 ├── usage_daily
 ├── transcription_locks
 ├── subscriptions
 ├── device_tokens
 ├── notification_preferences
 └── notification_log

verse_of_month   (public read, admin write)
popular_ranges   (public read, cron write — derived from user_verses)
app_config       (service role only)
```

## Soft-delete semantics

Soft delete is asymmetric and intentional:

- **`user_collections`**: soft-deleted (`deleted_at IS NOT NULL`).
  The "My Verses" default collection cannot be deleted at all
  (client guard in `SwipeableCollectionCard`, store guard in
  `deleteCollection`).
- **`user_verses`**:
  - If the verse is mastered (`progress.hard.completed === true`),
    soft-delete so it stays visible in the virtual `mastered`
    collection.
  - If not mastered AND not in any other collection, hard-delete.
  - If still in another collection, just remove the junction row
    (the verse remains active in the other collection).
- **`session_attempts`**: never deleted. Only `delete_own_account()`
  removes them.

The unique index on `user_verses` is partial (`WHERE deleted_at IS
NULL`), so the database alone wouldn't stop a second row for a
soft-deleted verse; `add_verse` restores it instead.

## Migration safety (invariant 11)

**Migrations ship to prod *before* the matching client.** `npm run
release` applies them, then merges. The iOS / Android client takes
days to clear App Store / Play review and even longer to propagate to
all users. So at any moment the DB schema may be ahead of the client by
one (or many) migrations, and a non-trivial number of users will be on
an older client *forever*. **Every migration must be safe under "old
client + new schema"**:

- **Additive only.** Never DROP a column, never NOT NULL an existing
  column, never tighten a CHECK on an existing column, never rename.
  Add nullable columns with permissive CHECKs.
- **Old client SELECTs must keep working.** Supabase JS returns all
  columns; old clients ignore unknown keys (verify your mapper doesn't
  choke). New nullable columns are safe.
- **Old client INSERTs/UPDATEs must keep working.** Old code won't
  reference new columns — they default to NULL. Make sure no NOT NULL
  or CHECK can be triggered by old write shapes. Migration 019 gives
  its new `NOT NULL` column and compound CHECK defaults for this reason.
- **New columns must be readable as NULL on the new client.** The new
  client may run against an un-migrated DB during rollout. Mappers and
  sort/filter logic must handle missing fields gracefully
  (`parseVerseRowExtras`, `rowToPrefs`).
- **Backfills** are fine but should not block old clients during
  migration. Avoid long-running migrations that take exclusive locks
  on tables old clients are reading.
- **Cleanup migrations** (DROP a column, tighten NOT NULL) are only
  safe after enough App Store rollout time has passed that the oldest
  live client is post-the-feature. Record the rollout window in the
  area doc; ship cleanup as a separate later migration.

The same constraint applies to **edge functions** (Bible API,
transcription) — they deploy from this repo and go live immediately.
New request/response shapes need backwards-compatible handling for old
clients still in the wild. See `docs/architecture/edge-functions.md`.

Migrations 005 and 006 drop columns; they predate this rule.

## Migration tooling

**Files.** Migrations live in `supabase/migrations/`. Files through 021
are named `NNN_name.sql` (`0101_popular_verses.sql` sorts between 009
and 010). New ones must be `YYYYMMDDHHMMSS_name.sql`, which is what
`supabase migration new <name>` creates. `kit.restoredMigrations` in
`package.json` lists older files that were renamed and that prod
already ran, so they don't count as new.

**Check.** `scripts/check-migrations.mjs` looks at new files, and also
runs in `npm run check`. It rejects bad names, and flags changes that
destroy data: the Squawk rules in `.squawk.toml` (drop table, column,
database or schema, truncate cascade, column type change, renames) plus
`truncate` and `delete from`. Plain runs only print the hits. With
`--strict`, which is how `npm run release` runs it, a flagged file is
refused unless it has an approval line:

```sql
-- destructive-ok: <what>, approved by <name> <YYYY-MM-DD>
```

Squawk can't see SQL inside `DO $$` blocks, so check those by hand.

**Local database.** Run through `scripts/db.mjs`:

| Command | Does |
|---|---|
| `npm run db:start` / `db:stop` | start or stop local Supabase |
| `npm run db:reset` | rebuild from migrations and `supabase/seed.sql` |
| `npm run db:env` | write the local URL and anon key to `.env.local` |
| `npm run db:status` | show what's running |
| `npm run db:types` | regenerate `supabase/database.types.ts` (`-- --check` fails if stale) |
| `npm run db:destroy` | remove the local stack and its data |

**Seed.** `supabase/seed.sql` runs only on local databases. Its logins
are described at its top. It also unschedules any local cron job that
would call a hosted URL.

**Tests.** `npm run test:db` runs the pgTAP files in `supabase/tests/`, one per
area. `catalog.test.sql`: every public table has RLS on, and no `SECURITY DEFINER`
function is open to clients unless allowlisted. `access.test.sql`: one reader can't
reach another's data, with known bugs as todos.

**Prod.** Migrations reach prod only through `npm run release`, which
also re-dates new files to sort after prod's newest. See
`docs/architecture/release.md`.

## Sharp edges

- `get_votm_mastery_count` has no definition: see
  `docs/features/home.md`.
- Access gaps in the stats functions: see `docs/features/insights.md`.
- Function `search_path` is unset on most functions, which Supabase
  Security Advisor flags (low risk).
- `get_tier_and_usage`, the RPC behind `getTierAndUsage` in
  `_shared/usage.ts`, isn't defined in any migration. Nothing calls
  that helper.
- `update_popular_ranges()` includes soft-deleted verses on purpose,
  since mastery is permanent.
- `popular_ranges` enumerates *every* sub-range with
  `generate_series` — table size grows fast. Top 1000 only retained.

## Decisions

- 2025-12-24 · `session_attempts` keeps its own verse columns and no FK to `user_verses` · Attempts must survive verse deletion for analytics.
- 2026-08-25 · Study prefs are columns, not `progress` keys · Progress writes are whole-object read-modify-write through `parseProgress`, which strips unknown keys, so old clients would clobber a JSONB key and Reset Progress would wipe it.
- 2026-08-25 · `verse_cache`, `app_config` and `verse_cache_stats` locked to the service role (020) · Clients never query them directly, so this is safe for old clients.
- 2026-11-11 · Account settings live in `profiles`, not auth metadata · RLS-guarded, additive, room for display names.
