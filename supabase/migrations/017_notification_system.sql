-- Migration: Notification system
--
-- Adds two tables (device_tokens, notification_preferences) plus a
-- debug log table (notification_log), enables pg_net for outbound
-- HTTP from cron, and schedules a per-minute cron pass that POSTs to
-- the send-notifications edge function with a Vault-stored bearer
-- secret. See docs/features/notification-system.md for the full
-- design and docs/features/notification-system-build-plan.md for the
-- chunked rollout.
--
-- Critical: cron_secret MUST be in Vault BEFORE applying this
-- migration. The DO $$ ... $$ guard below fails the deploy loudly if
-- the bootstrap was skipped, instead of the migration succeeding and
-- the cron silently 401-ing every minute. Bootstrap (one-time):
--
--   SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
--
-- Per CLAUDE.md invariant 11: this migration is additive only. New
-- tables; no edits to existing tables. Old clients never SELECT,
-- INSERT, or UPDATE these tables, so they're unaffected. The cron
-- query is a left-join-style "find users with a matching prefs row"
-- — old clients without a row are simply absent from the result.

CREATE EXTENSION IF NOT EXISTS pg_net;
-- pg_cron is already enabled (see migration 011).

-- ─── Vault bootstrap guard ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret'
  ) THEN
    RAISE EXCEPTION 'cron_secret not in Vault. Run: SELECT vault.create_secret(''<random-hex>'', ''cron_secret''); BEFORE applying this migration.';
  END IF;
END $$;

-- ─── Tables ─────────────────────────────────────────────────────

CREATE TABLE device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token    TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON device_tokens (user_id);

-- UNIQUE(expo_token) makes ownership transfer atomic via UPSERT: when
-- User B signs in on a device that previously belonged to User A,
-- the row's user_id flips. Compound (user_id, expo_token) would let
-- two rows coexist for one device → cron pushes A's content to a
-- device B is now using. Privacy leak. See design doc.

CREATE TABLE notification_preferences (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  master_enabled       BOOLEAN NOT NULL DEFAULT true,

  reviews_enabled      BOOLEAN NOT NULL DEFAULT true,
  reviews_cadence      TEXT NOT NULL DEFAULT 'daily'
                       CHECK (reviews_cadence IN ('daily', 'weekly')),
  reviews_weekday      SMALLINT
                       CHECK (reviews_weekday IS NULL
                              OR reviews_weekday BETWEEN 0 AND 6),
  CHECK ((reviews_cadence = 'daily' AND reviews_weekday IS NULL)
         OR (reviews_cadence = 'weekly' AND reviews_weekday IS NOT NULL)),
  reviews_hour         SMALLINT NOT NULL DEFAULT 9
                       CHECK (reviews_hour BETWEEN 1 AND 23),
  reviews_minute       SMALLINT NOT NULL DEFAULT 0
                       CHECK (reviews_minute BETWEEN 0 AND 59),

  in_progress_enabled  BOOLEAN NOT NULL DEFAULT true,
  in_progress_hour     SMALLINT NOT NULL DEFAULT 18
                       CHECK (in_progress_hour BETWEEN 1 AND 23),
  in_progress_minute   SMALLINT NOT NULL DEFAULT 0
                       CHECK (in_progress_minute BETWEEN 0 AND 59),

  -- IANA name; client INSERTs with current TZ. No DEFAULT — a 'UTC'
  -- default would mistime digests during the brief INSERT-to-first-
  -- update window. NOT NULL fails fast and visibly instead.
  timezone             TEXT NOT NULL,
  last_foregrounded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Per-day idempotency for DST fall-back (1 AM happens twice) and
  -- pg_cron over-fire after outage recovery. The match SQL excludes
  -- rows whose recorded date == today's local date.
  reviews_last_fired_local_date     DATE,
  in_progress_last_fired_local_date DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('reviews', 'in-progress')),
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL CHECK (status IN ('sent', 'skipped-empty', 'token-error', 'send-error')),
  body         TEXT,
  expo_ticket  TEXT,
  error        TEXT
);
CREATE INDEX ON notification_log (user_id, fired_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────
ALTER TABLE device_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their tokens" ON device_tokens
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own their prefs"  ON notification_preferences
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users read their own log" ON notification_log
  FOR SELECT USING (auth.uid() = user_id);
-- Edge function writes to log via service role (RLS bypassed).

-- ─── TZ-safe local-time helper ──────────────────────────────────
-- A single user with an unrecognized IANA name (post-tzdata-rename,
-- corrupt write) must not crash the entire cron pass.
CREATE OR REPLACE FUNCTION local_time_in_tz(tz text)
RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN now() AT TIME ZONE tz;
EXCEPTION WHEN others THEN
  RETURN now() AT TIME ZONE 'UTC';
END;
$$;

-- ─── Cron schedule ──────────────────────────────────────────────
-- Per-minute pass. The cron's frequency is server-internal scheduling;
-- user-visible cadence is daily-or-weekly per their preference.
SELECT cron.schedule(
  'send-notifications',
  '* * * * *',
  $$ SELECT net.http_post(
       url := 'https://bhvvagvnmoxpjgfffgpl.supabase.co/functions/v1/send-notifications',
       headers := jsonb_build_object(
         'Content-Type',  'application/json',
         'Authorization', 'Bearer ' ||
            (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'cron_secret')
       )
     ); $$
);

-- ─── Log retention ──────────────────────────────────────────────
-- Keep ~30 days; older is debug noise.
SELECT cron.schedule(
  'prune-notification-log',
  '0 3 * * *',
  $$ DELETE FROM notification_log WHERE fired_at < now() - INTERVAL '30 days'; $$
);
