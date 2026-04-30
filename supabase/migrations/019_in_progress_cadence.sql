-- Migration: In-progress cadence parity
--
-- 017 shipped In-progress as Mondays-only (no cadence/weekday columns
-- on `notification_preferences`). Settings UI now exposes the same
-- daily/weekly + weekday picker for In-progress as for Reviews. This
-- migration makes the schema match the UI.
--
-- Per CLAUDE.md invariant 11 (additive only, safe under old client +
-- new schema):
--
--   • New columns are added with defaults that preserve the prior
--     hard-coded behavior — cadence='weekly', weekday=1 (Monday).
--     Old clients that never write to these columns leave them at the
--     defaults; the edge function reads the defaults and behaves
--     identically to today.
--   • The compound CHECK matches the one already in place for reviews
--     (cadence='daily' ⇔ weekday IS NULL). It's added as NOT VALID
--     first to avoid scanning the whole table while old clients may
--     still be writing the row, then VALIDATEd in the same migration
--     once the backfill is complete (the table is small — ~one row
--     per user — so this is fast, but we follow the additive
--     pattern as a habit).
--   • No DROP, no rename, no NOT NULL on a pre-existing column.
--
-- Old clients (pre-this-feature):
--   • Don't reference `in_progress_cadence` / `in_progress_weekday`
--     in SELECT or UPDATE. PostgREST returns the columns; old code
--     ignores unknown keys (verified — `rowToPrefs` is explicit).
--   • An old-client INSERT only sets the columns it knows about.
--     The new columns fall back to their defaults — valid under the
--     CHECK.
--
-- New clients (this build):
--   • Read all columns; map missing → null gracefully.
--   • Default INSERT shape sets cadence='weekly', weekday=1 explicitly.

-- ─── Deployment order note ──────────────────────────────────────
-- This migration MUST land BEFORE the updated `send-notifications`
-- edge function is redeployed. The function's new SELECT references
-- `in_progress_cadence` and `in_progress_weekday` — querying an
-- un-migrated DB would fail with "column does not exist". Order:
--   1. supabase db push   (applies 019)
--   2. supabase functions deploy send-notifications
-- Reverse order = silent cron failures for ~however long the gap is.

-- ─── New columns ────────────────────────────────────────────────
-- Both columns have DEFAULTs that satisfy the compound CHECK below
-- *together*. Critical: a column-level default must produce a
-- CHECK-passing row on its own, even when the inserter (an old
-- client pre-this-feature) doesn't reference these columns at all.
-- Without `DEFAULT 1` on weekday, an old client INSERTing a fresh
-- prefs row would land cadence='weekly' + weekday=NULL, which the
-- compound CHECK forbids.
ALTER TABLE notification_preferences
  ADD COLUMN in_progress_cadence TEXT NOT NULL DEFAULT 'weekly'
    CHECK (in_progress_cadence IN ('daily', 'weekly'));

ALTER TABLE notification_preferences
  ADD COLUMN in_progress_weekday SMALLINT DEFAULT 1
    CHECK (in_progress_weekday IS NULL
           OR in_progress_weekday BETWEEN 0 AND 6);

-- ─── Backfill ───────────────────────────────────────────────────
-- Existing rows post-ADD: cadence='weekly' (via DEFAULT), weekday=1
-- (via DEFAULT — applied because the column is new). The UPDATE
-- below is belt-and-suspenders for any unusual row state and is a
-- no-op in the normal case.
UPDATE notification_preferences
SET in_progress_weekday = 1
WHERE in_progress_weekday IS NULL;

-- ─── Compound CHECK ─────────────────────────────────────────────
-- Mirrors the reviews_cadence/reviews_weekday CHECK from 017. The
-- table is tiny (~one row per user) so a regular CHECK with an
-- inline scan is fine — no need for the NOT VALID / VALIDATE dance.
ALTER TABLE notification_preferences
  ADD CONSTRAINT in_progress_cadence_weekday_match
  CHECK ((in_progress_cadence = 'daily' AND in_progress_weekday IS NULL)
      OR (in_progress_cadence = 'weekly' AND in_progress_weekday IS NOT NULL));
