# Feature: Notification System

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Last revised:** 2026-04-29
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — already shipped.
> This feature also introduces a **single coupled change** to
> `lib/store/review.ts`: `nextDueAfterDays` rounds the computed
> due-instant down to local midnight. Rationale below.

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
A third invisible source pings users who've been gone 14+ days. All
three are server-side; bodies are composed at fire-time so they're
always accurate.

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
- Reader functions (`isDueForReview`, `daysUntilDue`,
  `lockedVersesFor` in `lib/store/review.ts:116-184`) compare with
  `>=`/`<` and tolerate either precision.
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

-- Vault secret created out-of-band (dashboard or CLI), BEFORE this
-- migration runs:
--   SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
-- The edge function reads it at fire time and compares against the
-- incoming Authorization header.

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

  -- Re-engagement is invisible plumbing: no toggle, no time field
  -- (always 12 PM local).

  timezone             TEXT NOT NULL,  -- IANA name; client provides at INSERT
  last_foregrounded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_re_engagement_fired_at TIMESTAMPTZ,

  -- Per-day idempotency keys (DST + over-fire mitigation; see DST section)
  reviews_last_fired_local_date     DATE,
  in_progress_last_fired_local_date DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS ────────────────────────────────────────────────────────
ALTER TABLE device_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their tokens" ON device_tokens
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own their prefs"  ON notification_preferences
  FOR ALL USING (auth.uid() = user_id);

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
> midnight is ambiguous as a wall-clock time ("12:00 AM"
> vs "12:00 PM" confusion is real on iOS pickers; the user
> explicitly said start at 1 AM).

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

Body: *"<Hero reference> is waiting — pick up where you left off."*
Hero = most-recently-practiced in-progress verse (sort by
`lastPracticedAt` desc).

Tap deep-link: `IN_PROGRESS_COLLECTION_ID`
(`lib/store/index.ts:53`).

## Re-engagement source (invisible)

**No Settings toggle. No user-facing knob.**

**Trigger:**

1. `master_enabled = true`. (If the user ever turned off the master
   switch, we still respect it. Re-engagement isn't a back-door.)
2. Local time = exactly 12:00 PM.
3. `now() - last_foregrounded_at >= INTERVAL '14 days'`.
4. `last_re_engagement_fired_at IS NULL` OR
   `last_re_engagement_fired_at < last_foregrounded_at` (single-shot
   per quiet period; rearms once the user opens the app again).

Body: *"It's been a while. Come build your memorization habit."*

Tap target: in-progress collection if any in-progress verses;
otherwise mastered if any; otherwise home.

### Re-engagement idempotency under concurrent passes

Under READ COMMITTED isolation, two concurrent cron passes (rare
retries during outage recovery) could each pass the read check
before either updates `last_re_engagement_fired_at`. Mitigation:
**claim** each user with a row-locking UPDATE in the same
transaction *before* sending the push:

```sql
UPDATE notification_preferences
SET last_re_engagement_fired_at = now()
WHERE user_id = $1
  AND (last_re_engagement_fired_at IS NULL
       OR last_re_engagement_fired_at < last_foregrounded_at)
RETURNING 1;
```

If the UPDATE returns 0 rows, another pass already claimed the user
— skip the push. Otherwise send.

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
| 1 | App foregrounds | UPDATE `last_foregrounded_at = now()` (debounced — only if >5 min since last write). Re-check iOS permission status; if changed, update Zustand + AsyncStorage cache. | Server uses this for in-progress 24h gate and re-engagement 14d gate. |
| 2 | App foregrounds (TZ check) | Compare `Intl.DateTimeFormat().resolvedOptions().timeZone` against cached. If different, UPDATE `notification_preferences.timezone`. | User flew LAX → JFK; their digest needs to fire on JFK time. |
| 3 | App foregrounds (token refresh) | Call `getExpoPushTokenAsync()`. If different from cached, UPSERT `device_tokens`. | iOS occasionally rotates Expo tokens. |
| 4 | Permission newly granted | Get token, UPSERT `device_tokens`, INSERT default `notification_preferences` row if not exists (with current TZ). | This is the moment we go from "user has no row" to "user appears in cron query results." |
| 5 | Permission revoked externally (`granted` → `denied` between foregrounds) | DELETE `device_tokens` row for this device (belt-and-suspenders alongside Expo's `DeviceNotRegistered`). Surface revoked state in Settings. | Stop pushing immediately rather than waiting for the next dead-token bounce. |
| 6 | User toggles a preference | Optimistic Zustand + AsyncStorage write, then UPDATE `notification_preferences`. On failure: roll back local + toast. | Source of truth is server; local is a cache. |
| 7 | Sign-in completes | SELECT prefs row for this user. If exists → hydrate Zustand + AsyncStorage. If absent → INSERT default row with current TZ. | Account-level prefs follow the user across devices. |
| 8 | Sign-out | Clear AsyncStorage notification cache. **Do not** touch server tables. | `device_tokens` row stays; ownership transfers when the next user signs in (UNIQUE constraint). `notification_preferences` row stays so the user's settings persist across sign-outs. |
| 9 | Account switch on shared device | Effectively a sign-out + sign-in. The sign-in step (#7) loads the new account's prefs; the token row's `user_id` flips on token UPSERT (#3 or #4). | Privacy: A's verses never reach B. |
| 10 | First-launch race retry | If on foreground we find permission = granted but no `device_tokens` row exists for this token, retry the UPSERT. | Handles the case where Q1 grant happened but the network failed before the INSERT landed. |

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

Re-engagement uses `last_re_engagement_fired_at` (timestamp, not
date) because its idempotency is per-quiet-period, not per-day.

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
  idempotency on Reviews and In-progress; row-locking UPDATE on
  Re-engagement. Worst case: a user gets a duplicate push (race
  before the UPDATE commits). Acceptable.
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
- **Background sync of `last_foregrounded_at`.** The 5-min debounce
  prevents thrashing. If the user foregrounds 100 times in 5
  minutes, we write once.

## Build prerequisites

1. **`expo-notifications` install.** Not currently in `package.json`.
   `npx expo install expo-notifications`. Requires an EAS native
   rebuild; cannot ship via OTA.
2. **APN auth key.** A `.p8` from Apple Developer uploaded to Expo
   via `eas credentials`. iOS app needs the Push Notifications
   capability via `expo-notifications` config plugin in `app.json`.
3. **`pg_net` extension.** Enabled by the migration.
4. **Vault secret.** `cron_secret` created via dashboard or CLI
   *before* migration 017 runs. Document rotation in
   `supabase/README.md`.
5. **`config.toml` entry.** `[functions.send-notifications]
   verify_jwt = false`.
6. **CRON_SECRET env var on the edge function.** The function reads
   `Deno.env.get('CRON_SECRET')` and compares against the bearer.
   Set via `supabase secrets set CRON_SECRET=...`.
7. **Service-role usage.** The edge function uses
   `_shared/auth.ts:getAdminClient()` (line 140) for cross-user
   queries — same pattern as `bible` and `process-recording`.

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
│   ├── in-progress.ts
│   └── re-engagement.ts
├── push.ts           — Expo Push Service client + error handling
└── types.ts
```

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

- Cross-device dismissal (review on iPad → cancel iPhone push).
  Requires per-token-per-verse delivery state we don't keep.
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- Per-user quiet hours / DND windows. (iOS DND covers the case for
  v1.)
- A/B testing copy variants. (Server-trivially-addable later.)
- Web notifications. `expo-notifications` is no-op on web; Bread
  doesn't currently target push to web.
- Direct APNs or OneSignal integration. v2-or-later if Expo Push
  ever becomes a constraint.
- Per-user `notification_log` debug table. Promote to v1 if first
  user debug request actually needs it; otherwise edge-function
  console logs are enough for solo-engineer dev velocity.

## Open questions

None remaining at planning stage. The build phase will resolve:

- Concrete Settings UI styling (matches existing Settings screen
  patterns; no new design tokens).
- Exact debounce window for `last_foregrounded_at` updates (proposed
  5 min; tune during build).
- Whether to ship the dev-menu "Fire my digest now" button in
  release builds gated by `__DEV__` only, or behind a hidden
  long-press in TestFlight builds.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-27 | Notifications get their own feature doc, separate from review system. | Review-system doc shipped first; notification work needs its own scope. |
| 2026-04-28 | v1 ships three sources: Reviews, In-progress, Re-engagement. | Validates the multi-source model without over-investing. |
| 2026-04-28 | Permission asked via in-app explainer card after sign-in. | iOS prompt is one-shot; a generic explainer first is the conventional path. |
| 2026-04-28 | Verse references in body, not full text. | "Just a Bible verse" — no licensing or privacy concern. |
| 2026-04-28 | Notification taps land on a list, never auto-start a session. | Auto-start is intrusive; tapping is a soft hand-off. |
| 2026-04-28 | Foreground notifications suppressed. | User: "I don't really care for notifications while in the app." |
| 2026-04-28 | Re-engagement = invisible plumbing, no Settings toggle. | Safety net; exposing a knob would invite churn. |
| 2026-04-29 | In-progress cadence: weekly Mondays, with 24h activity skip. | Weekly habit; don't nag active users. |
| 2026-04-29 | Switch from per-verse local notifications to a daily digest. | Heavy-mastered users would blow past iOS's 64-pending cap; digest is the scaling story. |
| 2026-04-29 | Switch from local digest to server-side push via Expo Push Service. | Local notifications fix body at schedule time; only server push delivers fresh-at-fire-time bodies. |
| 2026-04-29 | Transport: Expo Push Service (not OneSignal, not Direct APNs). | Free, rate-uncapped at our scale, already in stack. Migration is one edge-function file change. |
| 2026-04-29 | Scheduling: Supabase pg_cron every minute → edge function. | Bread already uses pg_cron. Minute-resolution matches user-pickable fire-time precision. Cron is server-internal frequency; user cadence is daily/weekly. |
| 2026-04-29 | Preferences are account-level (server row), not device-level. | Account switch on shared device correctly switches notification prefs. AsyncStorage is a cache, not source of truth. |
| 2026-04-29 | `device_tokens` uses `UNIQUE(expo_token)` only. | Compound unique key would let two rows coexist for one device after a sign-out + sign-in, leaking User A's verse content to User B. Single-token uniqueness makes UPSERT atomically transfer ownership. |
| 2026-04-29 | Deep-link target = `MASTERED_COLLECTION_ID`; no new UI. | Mastered's default sort is already `due-first` (`lib/store/index.ts:147`) and per-collection sort persists. Tap lands on a list with due verses at top. Building a `?reviewView=true` filter was deferred indefinitely — not needed. |
| 2026-04-29 | Earliest selectable hour is 1:00 AM (not midnight). | Avoids 12:00 AM / 12:00 PM picker ambiguity. |
| 2026-04-29 | `nextDueAfterDays` rounds DOWN to local midnight (coupled review-system change). | **Product decision**: predictable digest catch-up. A verse mastered at 11:59 PM with `daysFromNow=1` becomes due at the next 12:00 AM, so any user-picked digest time on that day catches it. No "wait an extra day because the digest already fired" edge case. Forward-only; no migration; readers tolerate mixed precision. |
| 2026-04-29 | `notification_preferences.timezone` has no default; client must INSERT with current IANA TZ. | A `DEFAULT 'UTC'` would produce 9 AM-UTC = 2 AM-PST mistimings during the brief window between INSERT and the client's first TZ-update write. NOT NULL fails fast and visibly instead. |
| 2026-04-29 | TZ exception isolation via `local_time_in_tz()`. | One user with an invalid IANA name must not crash the entire cron pass. Function falls back to UTC for that pass; client self-heals on next foreground. |
| 2026-04-29 | Re-engagement idempotency via row-locking UPDATE before send. | Under READ COMMITTED, two concurrent passes could both pass the read check. UPDATE…RETURNING with the eligibility predicate claims the user; 0 rows → skip. |
| 2026-04-29 | Reviews + In-progress idempotency via per-day `last_fired_local_date`. | Mitigates DST fall-back (1 AM-twice → fires twice) and pg_cron over-fire after outage recovery. Spring-forward zero-fire is accepted as a once-a-year edge with no downstream impact. |
| 2026-04-29 | Per-user error isolation in edge function. | One bad row (corrupt JSONB, missing field) must not blackhole the rest of the pass. Try/catch per user; log + skip + continue. |

## Next steps

1. Settle final review on this doc.
2. Promote `planning` → `building` and add a chunk-by-chunk build
   plan (migration + edge function as PR #1, client integration as
   PR #2, Settings UI + Q1 card as PR #3, end-to-end real-device
   verification before merge).
3. Create the APN auth key + Vault secret out-of-band before PR #1.
