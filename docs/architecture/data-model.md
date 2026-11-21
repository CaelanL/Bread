# Data Model

Schema: `supabase/migrations/`. Generated columns and types:
`supabase/database.types.ts`.

## Tables overview

| Table | Owner | Purpose |
|---|---|---|
| `profiles` | per-user | account `translation` (`bible-versions.md`), names ([auth](auth.md#display-name)), 2.0 flag ([nav](navigation-and-routing.md#whats-new-in-20)) |
| `usage_daily` | per-user | Free/Supporter rate-limit counters |
| `subscriptions` | per-user | Tier (`free` \| `supporter`) with optional expiry |
| `verse_cache` | shared | Server-side Bible text cache under ESV/NLT licensing limits ([caching](bible-api-and-caching.md)) |
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
| `feedback_reports` | per-user, insert only | [Feedback](../features/feedback.md) |

Notification tables are covered in `docs/features/notifications.md`.

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

Indexes: `idx_user_collections_user (user_id) WHERE deleted_at IS NULL`, and the
unique `(user_id, client_id)` for client_id lookups.

RLS: owner SELECT/INSERT/UPDATE, signed in only. Insert and update are
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

Indexes (plus the unique `(user_id, client_id)`):
- `idx_user_verses_user (user_id) WHERE deleted_at IS NULL`
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

**Delete guard** (`20261114100000_verse_delete_guard.sql`): a `BEFORE DELETE` row trigger,
`private.guard_verse_delete()` (invoker), raises "This verse is still in a collection" when the
row has a `verse_collections` link that no other row of the same user and reference holds. Old
apps' collection delete could hard-delete a verse still in other collections; they ignore the
error, so it survives. Current deletes unlink first, `collapseVerse` moves links to the twin first
([bible-versions.md](bible-versions.md#switching)). Cascades (trigger depth > 1) and server
roles skip it.

### `verse_collections`

Migration `006_verse_collections_junction.sql` replaces `user_verses.collection_id`.

`verse_id` and `collection_id` are FKs with ON DELETE CASCADE, plus
`added_at`.

Unique: `(verse_id, collection_id)`. Indexes on both FKs.

RLS uses `EXISTS` on `user_verses.user_id` to require verse ownership for reads, inserts and deletes; an insert also needs the caller's collection.

A verse can be in many collections; see `delete_verse` for leaving the last.

### `verse_cache`

Migrations: `004_verse_level_cache.sql`, `20261114200000_verse_cache_text_rev.sql`
(adds `text_rev`, clears the licensed rows once). 004 also dropped `chapter_cache` and the first `verse_cache`.

One row per verse: `book`, `chapter`, `verse`, `version`, `text`,
`last_used_at` (bumped on every read for LRU) and `text_rev` (nullable,
the parsing revision that wrote the row).

Unique: `(book, chapter, verse, version)`. Indexed for chapter lookups,
LRU and per-version counts.

**Locked to the service role.** Migration 020 turned RLS on with no
policies and revoked `anon` and `authenticated`, the same for
`app_config` and the `verse_cache_stats` view (now `security_invoker`).
Edge functions reach them with the service role, which bypasses both.

Licensing limits, eviction, `text_rev` and the known gaps:
[bible-api-and-caching.md](bible-api-and-caching.md). Tests: `supabase/tests/verse-cache.test.sql`.

`getCacheStats` in `cache.ts` reads the view `verse_cache_stats`
(per-version count + min/max `last_used_at`).

### `session_attempts`

Migration: `009_session_attempts.sql`, `010_add_word_count.sql`
(`word_count`)

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID FK → `auth.users` | CASCADE on delete (`20261114120000_security_fixes.sql`) |
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

RLS: SELECT/INSERT of your own rows. **No UPDATE, no DELETE policy**:
append-only by design. Rows go only with the account (`delete_own_account()`
or the cascade).

### `usage_daily`, `subscriptions`

`usage_daily` (migration 001): per-user per-day counters used by the
edge function rate limiter. Unique on `(user_id, date)`. Each
`bible_fetch_count` increment counts against the user's tier limit
(see `docs/architecture/edge-functions.md`).

`subscriptions` (migration 001): one row per user. `tier` is `free` or
`supporter`. A NULL `expires_at` never expires. Read
by the edge function via `getUserTier()` to apply rate limits.

### `verse_of_month`, `popular_ranges`, `user_stats`

`verse_of_month`: [monthly references, public-bucket artwork and access rules](../features/home.md#verse_of_month).

`popular_ranges` (migrations `0101_popular_verses.sql`,
`015_popular_verses_mastered_only.sql`; public-readable) and `user_stats`
(migration 011) are written only by their cron functions:
`update_popular_ranges()` every hour (distinct users per *every*
sub-range of each mastered verse, via `generate_series`, so it grows fast;
top 1000 kept) and `update_user_stats()` every 6 hours
(`avg_time_per_word_ms` only from `stats_min_words`, 600, so null for most
users). Rules: [insights.md](../features/insights.md).

## Functions, triggers and cron

| Name | Type | Purpose |
|---|---|---|
| `update_updated_at_column()` | trigger fn | sets `updated_at = NOW()` |
| `update_user_collections_updated_at` | trigger | fires on UPDATE |
| `update_user_verses_updated_at` | trigger | fires on UPDATE |
| `upsert_verses(book, chapter, version, jsonb)` | legacy fn, service role only | no caller in the repo |
| `private.guard_verse_delete()` | trigger fn (invoker) | the `user_verses` delete guard above |
| `import_curated_collection()` | authenticated invoker | atomic Library import |
| `claim_intro_presentation(text)` | authenticated invoker | one account claim |
| `get_total_time_studied(user_id)`, `get_current_streak(user_id, tz_offset_min)` | invoker, signed in; the caller's own id only | [insights.md](../features/insights.md#streak) |
| `update_popular_ranges()`, `update_user_stats()` | SECURITY DEFINER, cron only | rebuild `popular_ranges`, `user_stats` |
| `delete_own_account()` | SECURITY DEFINER, signed in, `search_path ''` | orders account deletion across tables |
| `orphaned_feedback_photos()` | SECURITY DEFINER, service role only | [sweep](../features/feedback.md) |
| `register_device_token(token, platform)` | fn (SECURITY DEFINER) | assigns token to caller, including reassignment |
| `reorder_collections` | invoker, authenticated only | saves full custom order atomically |
| `copy_verse_to_collection` | invoker, authenticated only | checks both owners (junction RLS checks only the verse's) |
| `add_verse`, `delete_verse`, `delete_collection`, `save_verse_progress` | invoker, signed in | [add](../features/adding-verses.md#verse-identity), [delete](../features/library.md#deleting-a-verse), [progress](../features/review.md#what-a-session-writes) |
| shared collection functions | invoker wrappers | [table](../features/shared-collections.md#functions) |
| `get_cron_secret()` | fn (SECURITY DEFINER), service role only | reads `cron_secret` from Vault |
| `local_time_in_tz(tz)` | fn | local time in an IANA zone, UTC if the name is unknown |
| `verse_cache_stats` | view | per-version cache stats |
| `get_votm_mastery_count(book, chapter, vs, ve)` | SECURITY DEFINER, anyone, `search_path ''` | [Verse of the Month count](../features/home.md#the-card) |

`pg_cron` jobs: `update-popular-ranges` (hourly), `update-user-stats`
(every 6h), `send-notifications` (every minute, through `pg_net`),
`prune-notification-log` (daily), `delete-feedback-photos` (daily) and
`vacuum-pg-net-responses` (daily at 08:17 UTC, vacuums `net._http_response`).

## Relationships

```
auth.users
 ├── profiles (translation, names, welcome)
 ├── shared_collections ── members, verses (references), invites
 ├── user_collections (soft-delete; shared_collection_id → shared_collections)
 │     └── verse_collections (junction) ─── user_verses (soft-delete, no text)
 │                                               │
 │                                               └── (references) verse_cache (shared, LRU)
 ├── session_attempts (append-only, denormalized — no FK to user_verses)
 ├── user_stats (cron-computed)
 ├── usage_daily
 ├── subscriptions
 ├── device_tokens
 ├── notification_preferences
 ├── notification_log
 └── feedback_reports

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
  - If not mastered AND not in any other collection, hard-delete (the
    delete guard refuses it otherwise).
  - If still in another collection, just remove the junction row
    (the verse remains active in the other collection).
- **`session_attempts`**: never deleted, except with the account.

The unique index on `user_verses` is partial (`WHERE deleted_at IS
NULL`), so the database alone wouldn't stop a second row for a
soft-deleted verse; `add_verse` restores it instead.

## Migration safety (invariant 11)

**Migrations reach prod *before* the matching client** (`npm run release`
applies them, then merges), and store review and slow updates leave some users
on an older client forever. So the schema can be any number of migrations
ahead of a client, and **every migration must be safe under "old client + new
schema"**:

- **Additive only.** Never drop or rename a column, never make an existing
  column NOT NULL or tighten its CHECK. Add nullable columns with permissive CHECKs.
- **Old reads keep working.** supabase-js returns every column; old clients
  ignore unknown keys (check the mapper doesn't choke).
- **Old writes keep working.** Old code never sends new columns, so they
  default to NULL; no NOT NULL or CHECK may trip on an old write shape
  (migration 019 gives its new `NOT NULL` column and compound CHECK defaults).
- **The new client handles new columns missing.** It may run against an
  un-migrated DB during rollout (`parseVerseRowExtras`, `rowToPrefs`).
- **Backfills** mustn't block old clients: no long exclusive locks on tables they read.
- **Cleanup** (drop a column, tighten NOT NULL) only once the oldest live
  client is past the feature, as a separate later migration; record the
  rollout window in the area doc. Policy and grant cleanups check that each
  object exists (`pg_policies`, `to_regclass`, `to_regprocedure` in a `DO`
  block), since prod may predate some.

Edge functions go live at once too, so new request or response shapes must
still answer old clients ([edge-functions.md](edge-functions.md)).
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

**Local database.** `scripts/db.mjs` runs `npm run db:start`, `db:stop`, `db:status`,
`db:destroy` (removes the data too), `db:reset` (migrations, then `supabase/seed.sql`), `db:env`
(local URL and anon key to `.env.local`), `db:types` (`supabase/database.types.ts`;
`-- --check` fails if stale) and `node scripts/db.mjs phone` (relays the Mac's LAN address to the local API so a
phone on the same Wi-Fi can use it, until Ctrl-C; `db:start` keeps that address while it answers).

**Seed.** `supabase/seed.sql` runs only on local databases. Its logins
are described at its top. It also unschedules any local cron job that
would call a hosted URL.

**Tests.** `npm run test:db` runs the pgTAP files in `supabase/tests/`, one per
area. `catalog.test.sql`: every public table has RLS on; no `SECURITY DEFINER`
function is open to clients unless allowlisted, and each pins `search_path`; no
"Service role can manage" policy; `auth.uid()` only in a sub-select; no duplicate indexes; every user FK cascades or sets
null. `access.test.sql`: one reader can't reach another's data.

**Prod.** Migrations reach prod only through `npm run release`, which
also re-dates new files to sort after prod's newest. See
`docs/architecture/release.md`.

## Sharp edges

- `search_path` is unset on most invoker functions, which Supabase
  Security Advisor flags (low risk).

## Decisions

- 2025-12-24 · `session_attempts` keeps its own verse columns and no FK to `user_verses` · Attempts must survive verse deletion for analytics.
- 2026-08-25 · Study prefs are columns, not `progress` keys · Progress writes are whole-object read-modify-write through `parseProgress`, which strips unknown keys, so old clients would clobber a JSONB key and Reset Progress would wipe it.
- 2026-08-25 · `verse_cache`, `app_config` and `verse_cache_stats` locked to the service role (020) · Clients never query them directly, so this is safe for old clients.
- 2026-11-11 · Account settings live in `profiles`, not auth metadata · RLS-guarded, additive, room for display names.
- 2026-11-14 · Old apps' unsafe verse delete is refused by a trigger · Old clients stay in the wild; it refuses only a delete that would drop a collection link nothing else holds, which no current path does.
- 2026-11-14 · Owner policies are signed-in only with `(select auth.uid())`; "Service role can manage" policies dropped · The sub-select runs once per query, and the service role bypasses RLS anyway.
- 2026-11-21 · Hand edits on prod recorded in `20261121160000_prod_drift_fix.sql`; `get_tier_and_usage` dropped · `npm run doctor` showed prod drift. The RPC had no caller and let any client read any user's tier and usage.
