# Feature: Notification System

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Last revised:** 2026-04-29
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — already shipped.
> This feature introduces a **single coupled change** to
> `lib/store/review.ts`: `nextDueAfterDays` rounds the computed
> due-instant down to local midnight. Rationale below.
>
> **Platform:** **iOS only for v1.** Bread targets iOS, Android, and
> web; this feature ships first on iOS. Android (FCM, runtime
> permission, channel-level controls) is a separate v2 effort. Web
> push is permanently out of scope for `expo-notifications`.

## What this is

The user opens Bread, signs in for the first time on a device, and
sees a small explainer card asking whether they'd like notifications
for review reminders. They tap **Enable**, iOS prompts, they grant.
By default they're now opted in to a daily 9 AM digest. They can
change cadence (daily, or any specific weekday) and time-of-day in
Settings.

Once a day at their chosen wall-clock time, **if any of their
mastered verses are due for review**, they get one push:

> **Review time**
> Psalm 23 and 3 more ready for review.

Tap takes them to their Mastered collection. The Mastered
collection's default sort is already `'due-first'`
(`lib/store/index.ts:147`), so the verses named in the body sit at
the top of the list. They start a session.

A second source nudges users with stalled in-progress verses (weekly
Monday 6 PM by default, only if they haven't opened the app in 24h).

Both sources are server-side; bodies are composed at fire-time so
they're always accurate.

That's it — two sources. A user who has nothing in-progress and
nothing mastered receives nothing; that's intentional. Notifications
nudge users about *their content*, and a user with no content has
nothing meaningful to be reminded about.

## Why server-side push

iOS local notifications fix the body at **schedule time**, not fire
time. A digest body that names due verses ("Psalm 23 and 3 more
ready for review") goes stale the moment the user reviews,
masters, or deletes one of those verses between schedule and fire.
The alternatives are unappealing:

- **Generic body** ("Time to review your verses") — what most
  competitor apps do, but loses the personal nudge that makes the
  notification worth tapping.
- **Schedule-time named body** — what an earlier draft of this doc
  attempted. Worst case: the body names a verse the user already
  reviewed or deleted hours ago.

Server-side push composes the body fresh **at the minute we send
it**. Bodies are always accurate by construction.

### Why Expo Push Service (vs OneSignal, vs Direct APNs)

- **Free and rate-uncapped at Bread's scale.** Expo Push Service
  caps at 600 notifications/sec/project; Bread's foreseeable peak
  is two orders of magnitude below that.
- **Already in stack.** No new SDK, no new vendor disclosure.
- **Migration is cheap if we outgrow it.** OneSignal or Direct APNs
  later means rewriting one edge function. The schema (`device_tokens`,
  `notification_preferences`) doesn't change. The client side
  (`expo-notifications` for permission + token retrieval) doesn't
  change.

## Why the review system change (midnight-snap)

Today, `nextDueAfterDays(now, daysFromNow)` returns
`now + daysFromNow * 24h` — hour-precise. A verse mastered at
11:30 PM on Tuesday with a 1-day interval becomes due at 11:30 PM
Wednesday.

This feature changes it to round down to local midnight:

```ts
export function nextDueAfterDays(now: Date, daysFromNow: number): string {
  const target = new Date(now.getTime() + daysFromNow * MS_PER_DAY);
  target.setHours(0, 0, 0, 0); // local midnight, round down
  return target.toISOString();
}
```

**This is a product decision, not an engineering optimization.** The
user wants predictable digest catch-up: if every verse becomes due at
local midnight on day N, then *any* digest fire-time the user picks
on day N catches it — 1 AM digest, 9 AM digest, 11:59 PM digest. A
verse can never become due *during the day* and miss its own digest.

The previous "review at 11 PM with `daysFromNow=1` should be due 24h
later" rationale (currently in the comment in `lib/store/review.ts`)
is obsolete under this scheme. The new mental model is simpler:
*"due tomorrow"* literally means *"any time tomorrow."*

This change is **forward-only with no migration**:

- Old clients in the wild keep writing hour-precise `nextDueAt`. New
  clients write midnight-snapped. Both are valid ISO timestamps in
  the same JSONB field.
- Reader functions in `lib/store/review.ts` (`isDueForReview` at
  L122, `daysUntilDue` at L136, `lockedVersesFor` at L183) compare
  with `>=`/`<` and tolerate either precision.
- Mixed values self-resolve: each verse gets midnight-snapped on its
  next qualifying review by the new client.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Supabase                                                    │
│                                                              │
│  pg_cron (every minute)                                      │
│       │                                                      │
│       ▼  net.http_post → Authorization: Bearer <cron_secret> │
│  Edge function: send-notifications                           │
│   1. For each source, find users whose fire-minute matches   │
│      "now" in their stored IANA timezone                     │
│   2. Per matched user: query state, compose body, push       │
│   3. Handle Expo response (clean dead tokens, log)           │
│       │                                                      │
│  Tables:                                                     │
│    - device_tokens                                           │
│    - notification_preferences                                │
└──────────────────────────────────────────────────────────────┘
                                │
                                ▼  POST /push/send
                       Expo Push Service
                                │
                                ▼  APNs
                          User's device
                          (expo-notifications
                           handles delivery + tap)
```

**The cron runs every minute. Each user gets one digest per day**
(or per chosen weekday) — the cron polls every minute *to find
which users have a fire-minute equal to "now" in their TZ*. The
cron's frequency is server-internal scheduling; user-visible
cadence is daily-or-weekly per their preference.

## Schema (migration 017)

Two new tables, additive only. No edits to existing tables.

```sql
-- supabase/migrations/017_notification_system.sql

-- ─── Infrastructure ─────────────────────────────────────────────
-- pg_net for outbound HTTP from cron → edge function
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Vault secret stored once. Both pg_cron AND the edge function read
-- from Vault — single source of truth, atomic rotation.
--
-- One-time bootstrap (run BEFORE this migration via dashboard or CLI):
--   SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
--
-- This migration validates the secret exists, so a forgotten bootstrap
-- fails the deploy loudly instead of silently 401-ing every cron pass.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret') THEN
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

  timezone             TEXT NOT NULL,  -- IANA name; client provides at INSERT
  last_foregrounded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Per-day idempotency keys (DST + over-fire mitigation; see DST section)
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
  body         TEXT,           -- the rendered body, for replay/debug
  expo_ticket  TEXT,           -- the Expo Push response ticket id (for receipt lookup)
  error        TEXT            -- populated when status != 'sent'
);
CREATE INDEX ON notification_log (user_id, fired_at DESC);
-- Keep ~30 days of rows; older is debug noise. Pruning runs as a
-- separate cheap pg_cron job nightly.
SELECT cron.schedule(
  'prune-notification-log',
  '0 3 * * *',
  $$ DELETE FROM notification_log WHERE fired_at < now() - INTERVAL '30 days'; $$
);

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
-- corrupt write) must not crash the entire cron pass. Wrap the cast.
CREATE OR REPLACE FUNCTION local_time_in_tz(tz text)
RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN now() AT TIME ZONE tz;
EXCEPTION WHEN others THEN
  RETURN now() AT TIME ZONE 'UTC';
END;
$$;

-- ─── Cron schedule ──────────────────────────────────────────────
SELECT cron.schedule(
  'send-notifications',
  '* * * * *',
  $$ SELECT net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/send-notifications',
       headers := jsonb_build_object(
         'Content-Type',  'application/json',
         'Authorization', 'Bearer ' ||
            (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'cron_secret')
       )
     ); $$
);
```

### `config.toml` addition (ships in same PR)

```toml
[functions.send-notifications]
verify_jwt = false
```

The function does its own auth check against the cron-secret bearer.
Same convention as `bible` and `process-recording`
(`supabase/config.toml:38-46`).

### Why `UNIQUE(expo_token)` and not `UNIQUE(user_id, expo_token)`

A device's Expo push token is **per-device, not per-user**. With a
compound unique key, two rows can coexist for the same physical
device after a sign-out + sign-in flow — User A's row from yesterday
and User B's row from today. The cron then pushes to that token
twice, once for each user, and User A's verse content lands on User
B's foregrounded app. Privacy leak.

`UNIQUE(expo_token)` makes ownership transfer atomic via UPSERT:
when User B's client UPSERTs `(token, user_id=B)`, the row's
`user_id` flips from A to B. The cron only fires for the current
owner. Sign-out doesn't need to delete the row.

## Reviews digest source

**Defaults:** daily at 9:00 AM local. **Configurable:** cadence
(daily, or any specific weekday Mon–Sun), time (any minute from
1:00 AM through 11:59 PM).

> **Why 1 AM, not midnight, as the earliest selectable hour:**
> product call — the user picked the 1:00 AM through 11:59 PM
> range. Schema CHECK enforces.

### Edge function flow when a user matches the current minute

```
1. SELECT due-and-mastered verses for this user.
   Filter (Postgres-side):
     deleted_at IS NULL                       -- soft-delete check
     AND (progress->'hard'->>'completed')::boolean = true
     AND ((progress->'engraved'->>'nextDueAt') IS NULL
          OR (progress->'engraved'->>'nextDueAt')::timestamptz <= now())

2. If empty → no push. (Empty-day suppression.)

3. If 1 due → "<Reference> is ready for review"
4. If 2+ due → "<Hero reference> and N more ready for review"
   - Hero pick: earliest nextDueAt asc; ties broken by
     created_at asc; final tiebreaker `id` lexicographic
     (deterministic, no churn).

5. Title: "Review time"

6. Build references purely from user_verses columns
   (book, chapter, verse_start, verse_end). NO fetchVerse call.
   This honors CLAUDE.md invariant 3 (never bypass fetchVerse for
   text) — we never read verse *text* server-side; only references.

7. POST to Expo Push Service.

8. Per-user error isolation: try/catch around steps 1–7.
   One bad row never blackholes the rest of the pass.
```

### "Users matching this minute" SQL (Reviews branch)

```sql
SELECT np.user_id, np.timezone
FROM notification_preferences np
WHERE np.master_enabled  = true
  AND np.reviews_enabled = true
  AND extract(hour   FROM local_time_in_tz(np.timezone)) = np.reviews_hour
  AND extract(minute FROM local_time_in_tz(np.timezone)) = np.reviews_minute
  AND (np.reviews_cadence = 'daily'
       OR extract(dow FROM local_time_in_tz(np.timezone)) = np.reviews_weekday)
  -- DST + over-fire idempotency: fire at most once per local date
  AND (np.reviews_last_fired_local_date IS NULL
       OR np.reviews_last_fired_local_date
          < (local_time_in_tz(np.timezone))::date);
```

After a successful send, the function `UPDATE`s
`reviews_last_fired_local_date` to the user's current local date.

### Weekly cadence + short SR intervals — known trade-off

A user on weekly cadence (e.g. "Mondays only") who masters a verse
Tuesday with a 1-day interval gets pinged the *following* Monday —
6+ days late. Acknowledged: weekly users are explicitly opting into
low-frequency reminders. **Daily is the default** and the recommended
setting; weekly is for users who tell us they want less. A v2 could
add an "N overdue" copy variant on the weekly fire when the wait
exceeded the SR interval.

## In-progress nudge source

**Defaults:** weekly Mondays at 6:00 PM local. **Configurable:**
time only (cadence locked at weekly).

**Trigger gates** (all checked at fire time, server-side):

1. `master_enabled = true AND in_progress_enabled = true`
2. Local-minute matches `in_progress_hour` + `in_progress_minute` AND
   weekday = Monday.
3. `now() - last_foregrounded_at >= INTERVAL '24 hours'`. (Don't nag
   active users.)
4. **Eligibility, checked per-user after the SQL match:** ≥1
   in-progress verse with `bestAccuracy != null` on any difficulty.
   Definition matches `isInProgressVerse` (`lib/store/index.ts:1043`)
   exactly so client and server agree.
5. `in_progress_last_fired_local_date` is null or precedes today's
   local date.

### "Users matching this minute" SQL (In-progress branch)

```sql
SELECT np.user_id, np.timezone
FROM notification_preferences np
WHERE np.master_enabled     = true
  AND np.in_progress_enabled = true
  AND extract(hour   FROM local_time_in_tz(np.timezone)) = np.in_progress_hour
  AND extract(minute FROM local_time_in_tz(np.timezone)) = np.in_progress_minute
  AND extract(dow    FROM local_time_in_tz(np.timezone)) = 1   -- Monday
  AND now() - np.last_foregrounded_at >= INTERVAL '24 hours'
  AND (np.in_progress_last_fired_local_date IS NULL
       OR np.in_progress_last_fired_local_date
          < (local_time_in_tz(np.timezone))::date);
```

Eligibility (≥1 in-progress verse with `bestAccuracy != null`) is
checked per-user **after** the time-match query. The predicate
mirrors `isInProgressVerse` (`lib/store/index.ts:1043`); a comment
on that function flags the duplication so refactors stay in sync.

Body: *"<Hero reference> is waiting — pick up where you left off."*
Hero = most-recently-practiced in-progress verse (sort by
`lastPracticedAt` desc).

Tap deep-link: `IN_PROGRESS_COLLECTION_ID` (defined in
`lib/storage/index.ts:137`, exported from `lib/store/index.ts`).

## Why no re-engagement source

Earlier drafts had a third "invisible" source that pinged silent
users at 12 PM after 14 days of no app foregrounds. **Cut.** The
in-progress source already covers the meaningful cases:

- User has in-progress verses and goes silent → in-progress nudge
  fires the next eligible Monday.
- User mastered everything and goes silent → Reviews digest fires
  whenever a verse becomes due (could be days, weeks, or months
  later depending on SR interval).
- User has *nothing* in-progress and *nothing* mastered → nothing
  to nudge them about. A generic "come back" push at this point is
  not a content nudge; it's marketing. Out of scope.

This drops one source, one schema column (`last_re_engagement_fired_at`),
the row-locking idempotency UPDATE, and the noon SQL branch.

## Edge function execution model

The cron fires the function once per minute. Each invocation:

1. **Authenticate the cron caller.**
   ```ts
   const expected = await getCronSecretFromVault();  // service-role read
   const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
   if (!expected || !provided || !timingSafeEqual(expected, provided)) {
     return new Response('Unauthorized', { status: 401 });
   }
   ```
   Constant-time compare (not `===`) — the function is publicly
   reachable; a non-constant compare leaks bits via timing. Reject
   if either side is missing (deny-by-default).

2. **Run each source's match query, sequentially.** Reviews first,
   In-progress second. Each query returns `(user_id, timezone)`
   rows for users whose preferences hit the current minute.

3. **For each matched user, sequentially within a source:**
   - Try/catch the per-user block. One bad row (corrupt JSONB,
     malformed TZ, etc.) MUST NOT blackhole the rest of the pass.
   - Query the user's state (due verses for Reviews; in-progress
     eligibility check for In-progress).
   - If the source has nothing to send (empty digest, no eligible
     in-progress verse), `INSERT INTO notification_log (..., status =
     'skipped-empty')` and continue.
   - Compose the body. Look up the user's device token(s).
   - POST to Expo Push Service (one push per token).
   - On 2xx with a valid ticket: log `status = 'sent'`, store
     `expo_ticket`. Update `*_last_fired_local_date` for that source.
   - On Expo error response per token, route by code:
     - `DeviceNotRegistered` → DELETE the token row; log `status =
       'token-error'`.
     - `MessageRateExceeded` → log `status = 'send-error'` with
       backoff note; the next pass will try again.
     - `InvalidCredentials` / `MismatchSenderId` / other →
       log `status = 'send-error'` with the error string. These
       indicate APN cert misconfiguration; surface in dashboard logs.
     - `MessageTooBig` → should never happen (our bodies are short);
       log + skip.

4. **A single user CAN receive two pushes in one minute** (Reviews
   and In-progress fire-times collide at, say, 9:00 AM Monday).
   Both go through. Different intents, different deep-links;
   acceptable.

5. **Per-user error isolation is non-negotiable.** A bad row at
   user_id=47 must not affect user_id=48.

The function never queries Bible content. Body composition uses only
`user_verses` columns (`book`, `chapter`, `verse_start`, `verse_end`),
honoring CLAUDE.md invariant 3.

## Permission flow (client)

`expo-notifications` exposes four iOS permission states. The UI
must handle all four explicitly.

| State | What it means | UI in Settings | Action on toggle ON |
|---|---|---|---|
| `undetermined` | User has never been asked | Master toggle is OFF, label "Notifications" | Call `requestPermissionsAsync()`. iOS prompts. Grant → register token + INSERT default prefs. Deny → toast "Enable in iOS Settings", toggle stays OFF. |
| `granted` | User accepted | Toggle reflects `master_enabled` from server | Standard — toggle just flips `master_enabled`. |
| `provisional` | iOS 12+ quiet-delivery (we don't request this; only granted via OS) | Treat as granted for our toggle. Pushes deliver to Notification Center silently. | Same as granted. |
| `denied` | User said no | Toggle is OFF; tapping it routes to iOS Settings via `Linking.openSettings()` (does NOT call `requestPermissionsAsync()` — iOS one-shots that prompt; second call is a no-op). | Open Settings; user re-grants externally; on next foreground we re-check status and the toggle goes ON. |

### Q1 explainer card

After sign-in completes, if the user has not yet been shown the
notification explainer on this device (AsyncStorage flag), show a
generic in-app card:

> **Get review reminders**
> A daily nudge so verses you've worked on don't slip away.
>
> [Enable notifications]   [Maybe later]

- "Enable" routes through the permission flow above. On grant,
  registers the token and INSERTs default prefs.
- "Maybe later" sets the dismissed flag. The Q14 Settings tab badge
  takes over from there.

The card pre-checks `getPermissionsAsync()` before rendering: if the
user previously enabled and re-installed, we skip the card and
silently re-register the token on first foreground.

### Concurrency / cold-start UI invariants

- **In-flight ref gate.** `requestPermissionsAsync()` is one-shot on
  iOS; double-taps must not call it twice. Guard with a
  `useRef<boolean>` flag in the toggle handler.
- **Cold-start hydration.** On app open, render the master toggle
  using the **last-known status** persisted to AsyncStorage to avoid
  flicker. Then resolve the live status async; if it changed, update
  state.
- **No optimistic flip on permission requests.** Show a loading
  state while the OS prompt is up; flip only after the result lands.

### Q14 Settings tab badge

A "1" dot on the Settings tab appears when:

1. The Q1 explainer card has been dismissed AND not currently mounted.
2. iOS permission status is `undetermined` OR `denied`.
3. The user has at least 1 verse in their library.

Disappears the first time the user visits Settings. One-time
discovery hint.

## Foreground behavior

Pushes that arrive while the app is foregrounded are **suppressed**
(no banner, no list entry, no sound). The user explicitly said *"I
don't really care for notifications while in the app."* Wire the
foreground handler to return:

```ts
{ shouldShowBanner: false, shouldShowList: false,
  shouldPlaySound: false, shouldSetBadge: false }
```

The push still appears in iOS Notification Center if the user
backgrounds before clearing it (this is iOS-default for delivered
pushes; we don't override).

## Reconciliation triggers (client → server)

Every client event that needs to sync state to the server. The
client's job is **simple**: register/refresh the token, sync
preferences, keep `last_foregrounded_at` and `timezone` accurate.
All scheduling is server-side.

| # | Client event | Action | Why |
|---|---|---|---|
| 1 | App foregrounds | UPDATE `last_foregrounded_at = now()` (server-side debounced via `WHERE now() - last_foregrounded_at > INTERVAL '5 minutes'` — no client-side caching). Re-check iOS permission; if changed, update Zustand + AsyncStorage cache. | Server uses `last_foregrounded_at` for the in-progress 24h gate. The server-side WHERE makes the debounce idempotent under offline-then-online and across multiple devices. |
| 2 | App foregrounds (TZ check) | Compare `Intl.DateTimeFormat().resolvedOptions().timeZone` against cached. If different, UPDATE `notification_preferences.timezone`. | User flew LAX → JFK; their digest needs to fire on JFK time. |
| 3 | App foregrounds (token refresh) | **Only if permission is `granted` or `provisional`**: call `getExpoPushTokenAsync()`. If different from cached (or row absent), UPSERT `device_tokens`. Wrap in try/catch — if the call throws, log and continue. | iOS occasionally rotates tokens. Calling without permission throws. UPSERT is idempotent and handles both "no row exists yet" and "token rotated" — there's no separate first-launch race retry. |
| 4 | Permission newly granted | Get token, UPSERT `device_tokens`, INSERT default `notification_preferences` row if not exists (with current TZ). | This is the moment we go from "user has no row" to "user appears in cron query results." |
| 5 | Permission revoked externally (`granted` → `denied` between foregrounds) | DELETE `device_tokens` row for this device (belt-and-suspenders alongside Expo's `DeviceNotRegistered`). Surface revoked state in Settings. | Stop pushing immediately rather than waiting for the next dead-token bounce. |
| 6 | User toggles a preference | Optimistic Zustand + AsyncStorage write, then UPDATE `notification_preferences`. On failure: roll back local + toast. **If offline:** gray out Settings UI — no queued writes (per invariant 10). | Source of truth is server; local is a cache. Visible degradation beats silent data loss. |
| 7 | Sign-in completes | SELECT prefs row for this user. If exists → hydrate Zustand + AsyncStorage. If absent → INSERT default row with current TZ. | Account-level prefs follow the user across devices. |
| 8 | Sign-out | **Clear Zustand notification slice AND AsyncStorage notification cache.** Do not touch server tables. | Without the Zustand clear, Settings UI between sign-out and sign-in shows the previous user's prefs. `device_tokens` row stays — ownership transfers when the next user signs in (UNIQUE constraint). `notification_preferences` row stays so the user's settings persist across sign-outs. |
| 9 | Account switch on shared device | Effectively a sign-out + sign-in. The sign-in step (#7) loads the new account's prefs; the token row's `user_id` flips on token UPSERT (#3 or #4). | Privacy: A's verses never reach B. |

All writes go through `lib/notifications/api.ts` (a new module
following the `lib/storage/`-style wrapper convention required by
CLAUDE.md invariant 1).

## CLAUDE.md invariant 11 audit

Migration 017 ships **before** the new client. Walk through every
"old client + new schema" path:

1. **Old client SELECTs.** Old clients never query `device_tokens`
   or `notification_preferences` (the tables don't exist in their
   bundled mappers). Nothing to break.
2. **Old client INSERTs/UPDATEs.** Old clients never write to
   either table. RLS prevents accidental writes from any unrelated
   path.
3. **Old clients in the cron query.** The edge function joins the
   cron-side SELECT to `notification_preferences`. Old clients never
   inserted a row → never appear in results → never get a push.
   **Old clients receive zero notifications until they update.**
   This is acceptable: the feature is opt-in, "no push" is the
   pre-feature UX.
4. **New nullable columns added in v2.** Future fields (e.g.
   `reviews_quiet_hours_start`) MUST be nullable with sensible
   defaults. Old new-clients (post-v1, pre-quiet-hours) won't write
   them; the edge function reads `column ?? default`.
5. **Cleanup migrations.** None planned for v1. If a column ever
   becomes obsolete, wait until App Store rollout has elapsed past
   the introducing version, then DROP in a separate later migration.
6. **Edge function called only by pg_cron.** No client → edge-function
   request shape, so no backwards-compat surface. If a future v2
   edge function ever needs to be called from the client (e.g. a
   dev-mode "fire my digest now" button), it must follow the same
   tolerant-fields pattern as `bible` and `process-recording`.

### Coupled review-system change rollout

The midnight-snap to `nextDueAfterDays` is **forward-only**:

- Old clients: keep writing hour-precise `nextDueAt` until they
  update.
- New clients: write midnight-snapped from day one of the new
  binary.
- Mixed values are valid — readers tolerate both precisions.
- A verse touched by old client → mixed-state row → new client
  re-snaps on its next qualifying review. Self-resolving.

No data migration. No backfill. No coordination required.

## DST handling

`now() AT TIME ZONE np.timezone` evaluates against OS tzdata —
PostgreSQL handles DST transitions natively. But the wall-clock
matching scheme has two raw failure modes:

- **Fall-back (e.g. November, 1 AM happens twice).** A user with
  digest at 1:30 AM matches *twice* the same local date.
- **Spring-forward (March, 2 AM skipped).** A user with digest at
  2:30 AM matches *zero* times that day.

**Mitigation: per-day idempotency.** The
`reviews_last_fired_local_date` and
`in_progress_last_fired_local_date` columns track the last local
date we fired for that source. The match SQL excludes rows where
that date == today's local date.

- Fall-back: second match-attempt finds today's date already
  recorded → skipped. User gets one push.
- Spring-forward: user gets zero pushes that day. Acceptable —
  next day they're back on schedule. Documented as a sharp edge.

The midnight-snap on the review system has a **separate** DST
nuance: `setHours(0, 0, 0, 0)` returns local midnight, which on a
spring-forward day is still 12:00 AM (the skipped hour is 2 AM, not
midnight). So midnight-snap is robust to DST. The only artifact is
that on the fall-back day, "midnight" happens once but the calendar
day is 25 hours long — the verse becomes due at the first midnight
of the day, same as any other day.

## Edge cases to verify during build

- **TZ rename / removal.** IANA names get renamed (`Europe/Kiev` →
  `Europe/Kyiv`). PostgreSQL keeps aliases for a while, but a tzdata
  update could break a stored TZ. `local_time_in_tz()` catches and
  falls back to UTC; client self-heals on next foreground.
- **User on the move with stale TZ.** User flies LAX → JFK, doesn't
  open the app for 3 days. Server still thinks they're in PST.
  Their 9 AM digest fires at 9 AM PST = 12 PM EDT for those 3 days.
  Mild artifact; corrects on next foreground per trigger #2.
- **Install-after-uninstall.** User uninstalls, reinstalls.
  AsyncStorage gone, so the explainer card flag is gone. We pre-check
  permission status before showing the card; if iOS still has
  `granted`, we skip the card entirely and re-register the token on
  first foreground (trigger #4 fallback). If iOS has `denied`,
  tapping the master toggle in Settings routes to iOS Settings.
- **Multi-device, same account.** Two devices, two `device_tokens`
  rows (different tokens), one `notification_preferences` row. Both
  devices receive every push. Cross-device dismissal is **out of
  scope for v1** — if user reviews on device A, device B's push
  isn't cancelled. Acceptable; documented in "won't add."
- **Notification fires while app is foregrounded.** Suppressed (see
  Foreground behavior). Push still appears in Notification Center if
  user backgrounds before clearing.
- **Cron lateness.** pg_cron occasionally fires a few seconds late.
  Match against minute-of-now (in user's TZ), not minute-of-scheduled
  time. Within-minute jitter is acceptable.
- **Cron over-fire after Supabase outage recovery.** Per-day
  idempotency on both sources via `*_last_fired_local_date`
  columns. Worst case: a user gets a duplicate push (race
  before the UPDATE commits). Acceptable.
- **Cron-secret rotation.** Operator updates Vault. In-flight cron
  pass already carries the old secret; function read from Vault
  returns the new one → 401 on that pass. One pass dropped. Next
  pass picks up the rotated value cleanly.
- **Vault not bootstrapped.** Migration's `DO $$ ... $$` guard
  raises an explicit error pointing at the bootstrap command. Deploy
  fails loudly; no silent 401-loop.
- **Legacy null-`nextDueAt` mastered verses.** A verse mastered before
  the SR system shipped has `progress.engraved.nextDueAt = null` and
  the Reviews source treats it as "due now" until the user does a
  qualifying review. A user with one such verse gets it named in
  every daily digest until reviewed. Acceptable; SR-recovery on
  next session is the natural fix.
- **TZ junk during travel.** A flying phone may briefly report a
  weird IANA name (`Etc/GMT+5`) before settling on the destination
  TZ. `local_time_in_tz()` falls back to UTC for the bad row; client
  self-heals on next foreground via trigger #2. Worst case: one
  off-time push before recovery.
- **Multi-device same account.** Two devices, two tokens, both
  receive every push. A user with iPhone + iPad gets two pushes per
  digest — known limitation. Cross-device dismissal is a v2 candidate
  (filter by `last_seen_at` and only push to the most-recently-active
  token).
- **Edge function timeout.** Supabase edge functions cap at 150s
  default. At 100K MAU we'd hit ~70 users/min — well within budget.
  At 1M+ MAU we'd batch.
- **Token rotation mid-flight.** Expo rotates a token between two
  cron passes. Old token returns `DeviceNotRegistered` → edge
  function DELETEs the row. User gets nothing this pass; next
  foreground re-registers via trigger #3.
- **Empty `master_enabled`-but-disabled-everything.** Master ON, but
  all per-source toggles OFF → no SQL match → no push. Working as
  intended.
- **Background sync of `last_foregrounded_at`.** Debounced
  server-side via `WHERE now() - last_foregrounded_at > INTERVAL '5
  minutes'` — the client always issues the UPDATE on foreground;
  Postgres no-ops if recent. Idempotent across multi-device,
  recovers cleanly from offline-then-online.
- **Offline foreground.** UPDATE fails silently per CLAUDE.md
  invariant 10 (no offline write queue). Worst case: one in-progress
  push fires for a recently-active user. Acceptable.

## Build prerequisites

1. **`expo-notifications` install.** Not currently in `package.json`.
   `npx expo install expo-notifications`. Requires an EAS native
   rebuild; first device test happens on TestFlight or a local dev
   client. Subsequent JS-only changes can OTA.
2. **APN auth key.** A `.p8` from Apple Developer uploaded to Expo
   via `eas credentials`. iOS app needs the Push Notifications
   capability declared via the `expo-notifications` config plugin
   in `app.json`.
3. **`pg_net` extension.** `CREATE EXTENSION IF NOT EXISTS pg_net`
   in migration 017.
4. **Vault `cron_secret` bootstrapped.** One-time, run BEFORE
   migration 017:
   ```sql
   SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
   ```
   Migration 017's `DO $$ ... $$` guard fails the deploy if this
   wasn't done. Document rotation in `supabase/README.md`. Both
   pg_cron AND the edge function read this single secret — single
   source of truth, atomic rotation.
5. **`config.toml` entry.** Add `[functions.send-notifications]` with
   `verify_jwt = false`. Per-function gateway-bypass; the function
   handles auth itself via constant-time bearer compare against the
   Vault-stored secret.
6. **Service-role for cross-user queries.** The edge function uses
   `_shared/auth.ts:getAdminClient()` (L140) — same pattern as
   `bible` and `process-recording`. Note: those existing functions
   authenticate user JWTs (`verifyJwt`); this new function
   authenticates a *cron secret*, not a user JWT. Different threat
   model, same `verify_jwt = false` toml setting.

## Module layout (client)

```
lib/notifications/
├── index.ts          — public hooks
├── types.ts          — Preferences, push payload types
├── api.ts            — Supabase wrappers (all writes go here per invariant 1)
├── preferences.ts    — Zustand slice + AsyncStorage cache
├── permissions.ts    — request flow + 4-state UI helpers
├── tokens.ts         — token registration + foreground refresh
├── deep-links.ts     — response handler routing to expo-router
└── debug.ts          — __DEV__-only dev menu

supabase/functions/send-notifications/
├── index.ts          — entry point + cron-secret auth + per-source dispatch
├── sources/
│   ├── reviews-digest.ts
│   └── in-progress.ts
├── push.ts           — Expo Push Service client + error handling
└── types.ts
```

### Deep-link payload + routing

Each push carries a `data` field consumed by the client tap handler:

```json
{
  "source": "reviews",        // or "in-progress"
  "target": "mastered"        // or "in-progress"
}
```

`lib/notifications/deep-links.ts` registers
`Notifications.addNotificationResponseReceivedListener(...)` once
from `app/_layout.tsx` at root. The handler maps `target` to the
expo-router path:

| target | route |
|---|---|
| `"mastered"` | `/(tabs)/(library)/mastered` (renders `[id].tsx` with `id=mastered`) |
| `"in-progress"` | `/(tabs)/(library)/in-progress` (same dynamic route, `id=in-progress`) |

Mastered's default sort is `'due-first'` (`lib/store/index.ts:147`)
and per-collection sort persists via AsyncStorage (`getMasteredSort`
/ `persistMasteredSort` in `lib/store/index.ts:530–545`). If a user
has customized their Mastered sort to non-`due-first`, the named
verse won't be at the top of the list. Acceptable for v1; revisit
if early users report friction.

The handler ALSO handles cold-start: iOS may launch the app from a
notification tap. `getLastNotificationResponseAsync()` returns the
launch payload; the handler routes the same way.

Public hooks:

```ts
useNotificationPreferences()    // hydrated from AsyncStorage cache, synced to Supabase
useNotificationPermission()     // { status, request, openSettings }
useNotificationSettingsBanner() // boolean for Q14 badge
```

Internal:

```ts
api.upsertDeviceToken(token, platform)
api.deleteDeviceToken(token)
api.insertDefaultPreferences(timezone)
api.updatePreferences(patch)
api.updateLastForegroundedAt()  // debounced
api.updateTimezone(tz)
```

## What this feature explicitly will NOT add

- **Re-engagement source.** Earlier drafts had a third invisible
  source (14d inactive → noon push). Cut: the in-progress source
  already covers users with actionable content; users with no
  in-progress and no mastered have nothing to be reminded *about*,
  and a generic "come back" push at that point is marketing rather
  than a content nudge.
- **Android.** v2 effort. Different permission model
  (`POST_NOTIFICATIONS` runtime grant on API 33+), FCM transport,
  channel-level controls. This doc is iOS-shaped.
- **Web push.** `expo-notifications` is no-op on web; Bread doesn't
  target push to browsers.
- **Cross-device dismissal** (review on iPad → cancel iPhone push).
  Expo Push doesn't expose per-token cancel APIs; would require
  Direct APNs migration.
- **Direct APNs or OneSignal integration.** v2-or-later if Expo
  Push ever becomes a constraint.
- **Per-user quiet hours / DND windows.** iOS DND covers the case.
- **A/B testing copy variants.** Server-side; trivially addable
  later when there are users to A/B against.
- **LLM-generated copy.**
- **Marketing / promotional / streak-save notifications.**
- **Email or SMS channels.** Server cron makes either trivially
  addable; not v1.

## Open questions

None at planning stage. Build phase resolves tactical bits:

- Settings UI styling (matches existing Settings screen patterns; no
  new design tokens).
- Whether the dev-menu "Fire my digest now" button ships in release
  builds gated by `__DEV__`, or stays TestFlight-only.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-27 | Notifications get their own feature doc, separate from review system. | Review-system doc shipped first; notification work needs its own scope. |
| 2026-04-29 | v1 ships **two** sources: Reviews digest + In-progress nudge. iOS only. | Earlier drafts had three sources (re-engagement was the third). Cut on the basis that in-progress already covers users with content; users with neither in-progress nor mastered don't need a generic nudge. |
| 2026-04-28 | Permission asked via in-app explainer card after sign-in. | iOS prompt is one-shot; a generic explainer first is the conventional path. |
| 2026-04-28 | Verse references in body, not full text. | "Just a Bible verse" — no licensing or privacy concern. |
| 2026-04-28 | Notification taps land on a list, never auto-start a session. | Auto-start is intrusive; tapping is a soft hand-off. |
| 2026-04-28 | Foreground notifications suppressed. | User: "I don't really care for notifications while in the app." |
| 2026-04-29 | In-progress cadence: weekly Mondays, with 24h activity skip. | Weekly habit; don't nag active users. |
| 2026-04-29 | Switch from per-verse local notifications to a daily digest. | Heavy-mastered users would blow past iOS's 64-pending cap; digest is the scaling story. |
| 2026-04-29 | Switch from local digest to server-side push via Expo Push Service. | Local notifications fix body at schedule time; only server push delivers fresh-at-fire-time bodies. |
| 2026-04-29 | Transport: Expo Push Service (not OneSignal, not Direct APNs). | Free, rate-uncapped at our scale, already in stack. Migration is one edge-function file change. |
| 2026-04-29 | Scheduling: Supabase pg_cron every minute → edge function. | Bread already uses pg_cron. Minute-resolution matches user-pickable fire-time precision. Cron is server-internal frequency; user cadence is daily/weekly. |
| 2026-04-29 | Preferences are account-level (server row), not device-level. | Account switch on shared device correctly switches notification prefs. AsyncStorage is a cache, not source of truth. |
| 2026-04-29 | `device_tokens` uses `UNIQUE(expo_token)` only. | Compound unique key would let two rows coexist for one device after a sign-out + sign-in, leaking User A's verse content to User B. Single-token uniqueness makes UPSERT atomically transfer ownership. |
| 2026-04-29 | Deep-link target = `MASTERED_COLLECTION_ID`; no new UI. | Mastered's default sort is already `due-first` (`lib/store/index.ts:147`) and per-collection sort persists. Tap lands on a list with due verses at top. Building a `?reviewView=true` filter was deferred indefinitely — not needed. |
| 2026-04-29 | Earliest selectable hour is 1:00 AM (not midnight). | Product call — user picked the 1 AM through 11:59 PM range. Schema CHECK enforces. |
| 2026-04-29 | `nextDueAfterDays` rounds DOWN to local midnight (coupled review-system change). | **Product decision**: predictable digest catch-up. A verse mastered at 11:59 PM with `daysFromNow=1` becomes due at the next 12:00 AM, so any user-picked digest time on that day catches it. No "wait an extra day because the digest already fired" edge case. Forward-only; no migration; readers tolerate mixed precision. |
| 2026-04-29 | `notification_preferences.timezone` has no default; client must INSERT with current IANA TZ. | A `DEFAULT 'UTC'` would produce 9 AM-UTC = 2 AM-PST mistimings during the brief window between INSERT and the client's first TZ-update write. NOT NULL fails fast and visibly instead. |
| 2026-04-29 | TZ exception isolation via `local_time_in_tz()`. | One user with an invalid IANA name must not crash the entire cron pass. Function falls back to UTC for that pass; client self-heals on next foreground. |
| 2026-04-29 | Reviews + In-progress idempotency via per-day `last_fired_local_date`. | Mitigates DST fall-back (1 AM-twice → fires twice) and pg_cron over-fire after outage recovery. Spring-forward zero-fire is accepted as a once-a-year edge with no downstream impact. |
| 2026-04-29 | Per-user error isolation in edge function. | One bad row (corrupt JSONB, missing field) must not blackhole the rest of the pass. Try/catch per user; log + skip + continue. |
| 2026-04-29 | Cron secret stored in Supabase Vault, single source of truth. | Both pg_cron and the edge function read from the same secret. Constant-time bearer compare in the function; deny on unset. Migration's `DO $$ ... $$` guard fails the deploy if Vault wasn't bootstrapped first. |
| 2026-04-29 | `notification_log` table shipped in v1. | A debug request like "I didn't get my notification" needs a `SELECT * FROM notification_log WHERE user_id = X` answer, not a function-log dig. ~30 lines of SQL; nightly prune keeps storage in check. Worth shipping. |
| 2026-04-29 | iOS only for v1. Android deferred to v2. | Different permission model + FCM setup is its own scope. iOS is the dominant install base; ship iOS, learn, then port. |

## Next steps

1. Settle final review on this doc.
2. Promote `planning` → `building` and add a chunk-by-chunk build
   plan (migration + edge function as PR #1, client integration as
   PR #2, Settings UI + Q1 card as PR #3, end-to-end real-device
   verification before merge).
3. Create the APN auth key + Vault secret out-of-band before PR #1.
