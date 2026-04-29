# Feature: Notification System

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Reframed:** 2026-04-29 (round 7) — switched from iOS local
> notifications to **server-side push via Expo Push Service**.
> Composing the digest body fresh at fire-time (naming actual due
> verses) is impossible with iOS local notifications, which fix the
> body at schedule time. A Supabase cron + edge function + Expo Push
> delivers the personalized body the product wants.
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — already shipped on
> main. Round 7 makes **no changes to the review system** (round 6's
> proposed `nextDueAfterDays` midnight-snap is reverted — the server
> cron polls every minute, so hour-precise `nextDueAt` is fine).
>
> **History:** rounds 1–5d (per-verse local) and round 6 (digest local)
> are preserved in the Decisions Log and in git on this branch
> (`feat/notification-system-rewrite`):
> - `c6aa654` — round-5d baseline
> - `c993cab` — round-6 (digest local)

## Why server-side, not local

Round 6 designed a daily digest as iOS local notifications. Reviewing
that design surfaced a fundamental limit: **iOS local notifications
fix the body at schedule time, not fire time.** A digest body like
*"Psalm 23 and 3 more ready for review"* either has to be:

- **(a)** Composed at schedule time from currently-due verses → goes
  stale if the user reviews / masters / deletes between schedule and
  fire (round 6's option). Worst case: the digest names a verse that
  no longer exists.
- **(b)** Generic ("Time to review your verses") to avoid staleness →
  matches what most competitors do (Remember Me, Verses, Tecarta — all
  use generic-body local notifications) but loses the personal nudge.

Caelan's reframe in round 7: *"personalized means just writing the
verse, right? I feel like that's like bare minimum, otherwise the
notification is gonna look really bland and like I'm not gonna want
to click."* The personalized body is the product. So we need
fresh-at-fire-time composition, which forces server-side push.

## Architecture (high level)

```
┌────────────────────────────────────────────────────────────────┐
│  Supabase                                                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  pg_cron — runs every minute                             │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Edge function: send-notifications                       │ │
│  │  1. Query users whose digest fire-time = current minute  │ │
│  │     (in their stored timezone)                           │ │
│  │  2. For each, query their due verses                     │ │
│  │  3. Compose body                                         │ │
│  │  4. POST batch to Expo Push Service                      │ │
│  │  5. Log + clean up dead device tokens                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            │                                   │
│  Tables:                   ▼                                   │
│  - device_tokens     (POST exp.host/--/api/v2/push/send)      │
│  - notification_preferences                                    │
└────────────────────────────────────────────────────────────────┘
                             │
                             ▼ (Expo Push Service forwards to APNs)
                       ┌─────────────┐
                       │  user device │
                       │  Bread app  │  ← `expo-notifications` receives
                       └─────────────┘
```

- **Transport: Expo Push Service.** Free, no rate limit Bread can
  realistically hit (600 notifications/sec/project), no third-party
  vendor disclosure beyond Expo (already in stack). Migration to
  OneSignal or Direct APNs later is a single edge-function file
  change if needed.
- **Storage: Supabase tables.** `device_tokens` and
  `notification_preferences`, additive-only schema, RLS-gated by
  `auth.uid()`.
- **Scheduling: pg_cron, every minute.** Bread already uses pg_cron
  (`011_user_stats_cron.sql.done`, `010_popular_verses.sql.done`).
- **Client: `expo-notifications`** for permission flow, push token
  retrieval, foreground handler, and tap deep-link handling. Same
  client SDK as round 6, but the *scheduler* module is gone — all
  scheduling logic lives server-side.

## What collapses out vs round 6

| Round 6 (local) | Round 7 (server) |
|---|---|
| `lib/notifications/scheduler.ts` (~600 lines) | gone — server owns all scheduling |
| `CalendarTriggerInput` + DST handling | gone — server cron in user's TZ |
| Concurrent reconcile gate | gone — no descriptors to reconcile |
| Reconcile triggers (5 of them) | gone — no descriptors |
| iOS 64-cap math | gone — pushes don't queue on device |
| Body staleness from skipped reconciles | gone — body composed fresh |
| `nextDueAfterDays` midnight-snap | gone — server polls every minute |
| Walk-forward 365-day empty-digest logic | gone — server queries on demand |
| Hero verse "by `addedAt`" ambiguity | resolved server-side |
| Foreground-only-reconcile + casual-user gap (round-6 I17) | **fully resolved** — server fires regardless of last-foreground |

## Coupled review-system change

**None.** Round 7 reverts round 6's proposed `nextDueAfterDays`
midnight-snap. The server cron runs every minute and queries current
state at fire time, so hour-precise `nextDueAt` is fine — a verse due
at 9:01am simply gets caught by the 9:01am or later cron pass.

`lib/store/review.ts` returns to its pre-round-6 behavior (the comment
update in round 6 is reverted as part of this round).

## Requirements

### Must have

- [ ] Daily digest push notifications, fired server-side at the
      user's chosen wall-clock time in their timezone.
- [ ] Body composed at fire time — names a verse + count when
      multiple are due.
- [ ] In-progress nudge source (server-side cron, weekly).
- [ ] Re-engagement source (server-side cron, fires once after 14d
      inactivity).
- [ ] Settings UI: master toggle, per-source toggles (Reviews, In
      progress), Reviews cadence (daily/weekly) + time picker, In
      progress time picker.
- [ ] Permission flow: in-app explainer card after sign-in,
      graceful denial handling, deep-link to iOS Settings.
- [ ] Tap → deep-link to the right surface (digest → library
      review view).
- [ ] Device token registration on auth + permission grant; token
      refresh on every app foreground.
- [ ] AsyncStorage cache of preferences for offline-readable
      Settings UI; source of truth is Supabase.
- [ ] Stale device token cleanup on `DeviceNotRegistered` from
      Expo response.

### Nice to have

- [ ] Re-engagement source ships as invisible plumbing (no toggle).
- [ ] Per-user cron-pass logging table for debugging.
- [ ] Dev-mode "fire my digest now" button (calls edge function
      directly with current user ID).

### Explicitly out of scope (v1)

- Cross-device dismissal coordination (iPad reviews don't cancel
  iPhone push — requires per-token-per-verse state we don't keep).
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- User-configurable quiet hours (DND covers the case for v1).
- Android-specific behaviors beyond `expo-notifications` defaults.
- A/B testing copy variants (server-side-trivially-addable later;
  not v1).

## CLAUDE.md invariant 11 — backend ships immediately, client is delayed

This is the single most important architectural constraint for round
7. Caelan flagged: *"backend additions immediately go live in
Supabase, while client changes will be delayed."* Correct, and the
design accommodates it explicitly.

### Migration shape — additive only

Two new tables. Zero changes to existing tables.

```sql
-- Migration 017_notification_system.sql

CREATE TABLE device_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token      TEXT NOT NULL,             -- ExponentPushToken[xxx]
  platform        TEXT NOT NULL,             -- 'ios' | 'android' (future)
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_token)
);

CREATE TABLE notification_preferences (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  master_enabled       BOOLEAN NOT NULL DEFAULT true,
  reviews_enabled      BOOLEAN NOT NULL DEFAULT true,
  reviews_cadence      TEXT NOT NULL DEFAULT 'daily',     -- 'daily' | 'weekly'
  reviews_weekday      SMALLINT,                          -- 0–6, only for weekly; null for daily
  reviews_hour         SMALLINT NOT NULL DEFAULT 9,       -- 0–23
  reviews_minute       SMALLINT NOT NULL DEFAULT 0,       -- 0–59
  in_progress_enabled  BOOLEAN NOT NULL DEFAULT true,
  in_progress_hour     SMALLINT NOT NULL DEFAULT 18,
  in_progress_minute   SMALLINT NOT NULL DEFAULT 0,
  -- re-engagement is invisible plumbing; no toggle, no time field
  -- (always 12pm local per Q15)
  timezone             TEXT NOT NULL DEFAULT 'UTC',       -- IANA name, e.g. 'America/Los_Angeles'
  last_foregrounded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_re_engagement_fired_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: standard ownership pattern matching existing tables
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their tokens" ON device_tokens
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own their prefs" ON notification_preferences
  FOR ALL USING (auth.uid() = user_id);

-- pg_cron — every minute
SELECT cron.schedule(
  'send-notifications',
  '* * * * *',
  $$ SELECT net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/send-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
       )
     ); $$
);
```

### Old client + new schema behavior (the invariant 11 audit)

Walk through every "old client + new schema" path explicitly:

1. **Old client SELECTs.** Old clients never query `device_tokens` or
   `notification_preferences` (they don't know they exist). ✓
2. **Old client INSERTs/UPDATEs.** Old clients never write to either
   table. RLS prevents accidental writes from any unrelated path. ✓
3. **Old clients in the cron query.** The edge function's "users to
   ping this minute" query reads from `notification_preferences`. Old
   clients never inserted a row → never appear in the result → never
   get a push. **Old clients receive zero notifications until they
   update.** This is acceptable: the feature is opt-in, and "no push"
   is the same UX old clients had pre-feature.
4. **New schema columns added later.** Future fields (e.g.
   `reviews_quiet_hours_start`) MUST be nullable with sensible
   server-side defaults. Old new-clients (post-feature, pre-quiet-
   hours) won't write the column; the edge function reads `column ??
   default` everywhere.
5. **Schema cleanup migrations.** None planned. If a column ever
   becomes obsolete, it must wait until App Store rollout time has
   passed before being dropped (per CLAUDE.md invariant 11). Doc the
   rollout window in the relevant feature doc.

### Old client + new edge function behavior

The edge function is invoked **only by pg_cron**, never by the client.
There's no client→edge-function request shape to keep stable. The
edge function reads tables via Supabase service-role client. **No
backwards-compat surface to manage.**

The single exception: if a future v2 edge function ever needs to be
called *from the client* (e.g. for a dev-mode "fire my digest now"
button), it MUST handle missing fields tolerantly the same way Bible
API and `process-recording` do today. v1 has no such call.

### Rollout sequence

1. **Migration 017 deploys** (additive: two new tables + cron
   schedule). The cron starts running every minute. With zero rows
   in `notification_preferences`, the edge function does nothing and
   exits in a few ms.
2. **Edge function deploys** alongside the migration.
3. **Client update goes through App Store review.** Old clients
   continue to receive zero notifications (correctly).
4. **Users update.** On first launch post-update, client registers
   device token + writes default `notification_preferences` row →
   user starts appearing in cron query results → user starts getting
   pushes.

The system **fails closed** during the rollout window — old clients
get nothing, which is the safe failure mode.

## Architectural decisions

### Server-side cron + Expo Push Service

Decided over local notifications because:
- Personalized body composed at fire time is the product (Caelan's
  round-7 reframe).
- Server cron fires regardless of when the user last opened the app,
  resolving the round-6 I17 casual-user gap structurally.
- Future capabilities (cross-device dismissal, A/B-tested copy,
  smarter copy without app updates) become possible.

Decided over OneSignal / Direct APNs because:
- **OneSignal** would add a third-party SDK and a new privacy
  disclosure. Bread's tech stack is small; another vendor is
  friction. Free tier is 10K MAU — fine for years, but free Expo
  Push has no MAU limit, just a 600/sec rate cap that's effectively
  unbounded.
- **Direct APNs** is the right answer at scale, but adds JWT signing
  and APNs auth-key management for no v1 benefit. Migrating
  Expo Push → Direct APNs later is one edge-function file rewrite;
  the tokens table doesn't change.

### Edge function design — minute-resolution cron

Cron runs every minute. Edge function runs the following query:

```sql
-- "Which users have a digest matching the current minute, in their TZ?"
SELECT np.user_id, np.timezone, np.reviews_enabled, np.in_progress_enabled, ...
FROM notification_preferences np
WHERE np.master_enabled = true
  AND (
    -- Reviews digest match
    (np.reviews_enabled = true
     AND extract(hour FROM (now() AT TIME ZONE np.timezone)) = np.reviews_hour
     AND extract(minute FROM (now() AT TIME ZONE np.timezone)) = np.reviews_minute
     AND (np.reviews_cadence = 'daily'
          OR (np.reviews_cadence = 'weekly'
              AND extract(dow FROM (now() AT TIME ZONE np.timezone)) = np.reviews_weekday)))
    OR
    -- In-progress match (always weekly Mon, fixed weekday)
    (np.in_progress_enabled = true
     AND extract(hour FROM (now() AT TIME ZONE np.timezone)) = np.in_progress_hour
     AND extract(minute FROM (now() AT TIME ZONE np.timezone)) = np.in_progress_minute
     AND extract(dow FROM (now() AT TIME ZONE np.timezone)) = 1)  -- Mondays
    OR
    -- Re-engagement: invisible, fires at 12pm local if 14+d inactive
    (extract(hour FROM (now() AT TIME ZONE np.timezone)) = 12
     AND extract(minute FROM (now() AT TIME ZONE np.timezone)) = 0
     AND now() - np.last_foregrounded_at >= INTERVAL '14 days'
     AND (np.last_re_engagement_fired_at IS NULL
          OR np.last_re_engagement_fired_at < np.last_foregrounded_at))
  );
```

Returns at most a few hundred rows per minute even at 100K MAU
(uniform distribution across 24*60 = 1440 minutes/day = ~70 users/min
per source). For each row, the function queries due verses and pushes.

**Why minute-resolution, not five-minute or hourly:** users pick
their digest time to the minute (e.g. "9:00 am"). Five-minute
resolution feels imprecise. Cost is the same — pg_cron firing every
minute is negligible.

### Sources are still pure conceptually; they live server-side

The "source" abstraction from rounds 5–6 (each source emits
descriptors) is gone in its local form, but the *conceptual* shape
holds: each source is a function that, given the user's state and
the current minute, decides whether to send and what body to use.

```ts
// Conceptual; actual implementation is in send-notifications/index.ts
type ServerSource = {
  id: 'reviews-digest' | 'in-progress' | 're-engagement';
  matchesNow: (prefs: Row, nowInTz: Date) => boolean;
  buildPush: (state: { user, prefs, dueVerses, ... }) => ExpoPushPayload | null;
};
```

The Q18 extensibility contract (round 5b) holds: adding a new source
is "write a new branch in the SQL `WHERE` clause + a new function in
the edge function file." No client changes for a new source unless it
needs a Settings toggle.

### Client preference sync

Single source of truth: Supabase row in `notification_preferences`.
Client mirrors it to AsyncStorage for offline-readable Settings UI.

- **On app start (post-auth)**: SELECT the user's pref row. Hydrate
  Zustand notification slice. Cache to AsyncStorage.
- **On Settings change**: optimistic Zustand update + AsyncStorage
  write + Supabase UPDATE. Failure → rollback Zustand + AsyncStorage,
  show error toast.
- **On sign-out**: clear AsyncStorage notification cache. Server pref
  row stays (next sign-in re-hydrates).
- **On sign-in (different account)**: SELECT new user's prefs, replace
  cache. Round-6 "preferences are device-level" decision is **reversed
  in round 7** — they're now account-level (server-stored). On a
  shared device, account switch correctly switches notification
  prefs. **This is a strict UX improvement over round 6.**

Per CLAUDE.md invariant 1, all writes go through `lib/storage/` (or
the new `lib/notifications/api.ts` wrapper). No direct supabase client
calls from components.

## Open Questions

Most round-1-through-6 product/UX answers carry forward unchanged.
The questions specific to round-7 architecture are flagged below.

- **Settled:** Q1 (explainer card after sign-in, unchanged), Q2
  (master + 2 visible toggles, unchanged), Q3 (in-progress copy,
  unchanged), Q4 (Reviews digest cadence/time, **server-side**), Q5
  (foreground suppress, unchanged), Q6 *(was 64-cap; obsolete —
  server doesn't queue on device)*, Q7 (**simplified**: client
  triggers are now just "sync prefs to server" / "register token";
  no scheduler reconcile), Q8 (deep-link, unchanged), Q9 (verse
  refs in copy, unchanged), Q10 (**migrations apply now —
  invariant 11 audit above**), Q11 *(per-verse vs digest; obsolete
  — digest)*, Q12 (state-aware permission UI, unchanged), Q13
  (re-engagement, **server-side cron**), Q14 (Settings tab badge,
  unchanged), Q15 (per-source fire times, unchanged), Q16 *(was
  trigger types; obsolete — no client triggers)*, Q17 (testing,
  **server-side additions**), Q18 (extensibility, **server-side
  contract**).

---

### Q1: Permission flow — explainer card after sign-in

*Unchanged from round 5d / 6.* Generic in-app card after sign-in,
one-time per device, AsyncStorage-tracked. Tap "Enable" calls
`Notifications.requestPermissionsAsync()` (or routes to iOS Settings
if pre-denied). On grant, also call
`Notifications.getExpoPushTokenAsync()` and POST to `device_tokens`.

Card behavior, dismissal flag timing, install-after-uninstall
pre-check, copy direction — all unchanged.

---

### Q2: Settings UI — master + per-source toggles

```
Notifications
─────────────────────────
[●] Notifications              ← master (state-aware per Q12)
    Reviews                    ← per-source
      Cadence: Daily ▾
      Time:    9:00 am ▾
    In progress                ← per-source
      Time:    6:00 pm ▾
```

Re-engagement is invisible plumbing — no toggle in Settings.

Each toggle/picker change writes to:
1. Zustand notification slice (optimistic).
2. AsyncStorage (cache).
3. Supabase `notification_preferences` (source of truth).

Failure on (3) → rollback (1) and (2), surface toast.

Off-toggle confirmation modals (master OFF, per-source OFF) match
round 5b's pessimistic-state pattern.

---

### Q3: In-progress copy

*Unchanged.* Names the most-recently-practiced in-progress verse,
deep-links to the in-progress collection. Copy direction:
*"Psalm 23 is waiting — pick up where you left off."*

Server-side trigger: weekly Monday (configurable cadence is v2),
6pm local, fires only if user has ≥1 in-progress verse with
`bestAccuracy != null` AND user hasn't foregrounded in 24h.

The 24h activity-skip check is server-side: edge function compares
`now() - last_foregrounded_at < INTERVAL '24 hours'` and skips
the push if so. **This fixes round 6's I14** — the round-6 design
checked at schedule time only; the server checks at fire time, which
is what the rule actually meant.

---

### Q4: Reviews digest — cadence and fire time

**Daily by default, 9:00 am local. User-configurable cadence
(daily / weekly Mon-Sun) and time-of-day.**

Edge function flow when a user matches the current minute:

```
1. Query: SELECT mastered verses where nextDueAt <= now().
   Filter: progress.hard.completed = true AND
           (progress.engraved.nextDueAt IS NULL
            OR progress.engraved.nextDueAt <= now()).
2. If empty → skip (no push). The user gets nothing this fire-time;
   they'll get one next fire-time when there's actually something due.
3. If 1 due → body: "<Verse Reference> is ready for review"
4. If 2+ due → body: "<Verse Reference> and N more ready for review"
   - Hero verse pick: deterministic — earliest nextDueAt, ties
     broken by verse `created_at` ascending.
5. Title: "Review time"
6. POST to Expo Push Service.
```

Body composition is **always fresh** because the cron queries the DB
right before composing. Round-6 staleness scenarios (deleted verse
named in body, reviewed verse still in count) are impossible by
construction.

**Empty-digest behavior:** suppressed. No "no reviews today" copy.

---

### Q5: Foreground behavior

*Unchanged.* Foreground handler returns `shouldShowBanner: false`,
`shouldShowList: false`. Push still appears in OS Notification Center
once user backgrounds.

---

### Q6: ~~iOS pending-notification cap~~ *(obsolete)*

Round 7: pushes don't queue on the device. Each push is delivered
when sent. iOS holds them in Notification Center after delivery
(uncapped — these are *delivered* notifications, not *pending*
ones). The 64-cap only applied to local pending. Gone.

---

### Q7: Client-side reconcile triggers — *radically simplified*

There's nothing to reconcile on the client. Server owns scheduling.
What the client *does* track:

| # | Client event | Action |
|---|---|---|
| 1 | App foregrounds | Update `last_foregrounded_at` server-side (debounced — only if >5 min since last update). Re-check iOS permission. |
| 2 | Permission newly granted | Get Expo push token, INSERT/UPSERT `device_tokens`, INSERT default `notification_preferences` if not exists. |
| 3 | Permission revoked externally (granted → denied) | Optionally DELETE `device_tokens` row (server stops pushing — though Expo also returns DeviceNotRegistered, so this is belt-and-suspenders). Surface in Settings UI. |
| 4 | User changes a preference | Optimistic Zustand + AsyncStorage write, then UPDATE `notification_preferences`. |
| 5 | Sign-in completes | SELECT prefs row, hydrate Zustand + AsyncStorage. INSERT default prefs row if first-time on this account. |
| 6 | Sign-out | Clear AsyncStorage notification cache (DB row stays for next sign-in). |

**Concurrent-write protection:** Supabase RLS + `UNIQUE` constraints
prevent corruption. If the user toggles a switch twice rapidly,
optimistic Zustand reflects the latest state; the second UPDATE
overwrites the first server-side. No race.

**Token refresh:** Expo push tokens *can* change (rare, but iOS
sometimes rotates them). Call `getExpoPushTokenAsync()` on every app
foreground; if returned token differs from the cached one, UPSERT
to `device_tokens`. Cheap.

---

### Q8: Deep-link target

*Unchanged.* Always to a collection.
- **Reviews digest** → library, filtered to the review view (route
  `/(tabs)/(library)?reviewView=true`). **Implementation note**: this
  route did not exist as of round-6 audit (round-6 finding C2). Build
  prerequisite: either add the param or repoint to the existing
  Mastered collection (`/(tabs)/(library)/mastered`) which already
  shows due verses via `useDueCounts`. Caelan to confirm during
  build.
- **In progress** → `IN_PROGRESS_COLLECTION_ID`.
- **Re-engagement** → in-progress collection if any in-progress;
  otherwise mastered if any; otherwise home.

Tap deep-link payload: the edge function includes a `data` field on
the push (`{ source: 'reviews-digest', deepLink: '/(tabs)/(library)?reviewView=true' }`).
`expo-notifications` response handler (in `lib/notifications/deep-links.ts`)
reads it and routes via `expo-router`.

Never auto-start a session.

---

### Q9: Verse text in payloads

*Unchanged.* Reference only, not full verse text.

Body format (locked round 7):
- 0 due → suppress (no push sent).
- 1 due → *"Psalm 23 is ready for review"*
- 2+ due → *"Psalm 23 and N more ready for review"*

Title: *"Review time"*

**Hero verse pick (resolved):** earliest `nextDueAt` ascending; ties
broken by verse `created_at` ascending. Deterministic, no churn (the
push is composed once and sent — there's no cancel/reschedule loop
that could reshuffle).

**Body length:** longest realistic case is *"Song of Solomon 8:14
and 999 more ready for review"* — well under iOS's lockscreen
truncation. Not a concern.

---

### Q10: Migration concerns — *the central round-7 concern*

See "CLAUDE.md invariant 11" section above. Two new tables, one new
edge function, one new pg_cron schedule. All additive.

**Native rebuild:** `expo-notifications` requires a native rebuild
(it's not in the JS bundle). Cannot ship via Expo updates — needs a
new App Store binary. Round 6 had the same constraint.

---

### Q11: ~~Per-verse vs digest~~ *(settled — digest)*

Settled in round 6: digest. Round 7 adds: digest body composed
**fresh at fire time** (the round-6 staleness concern is gone).

---

### Q12: iOS permission state UI

*Unchanged from round 5d.* Four states (`undetermined`, `granted`,
`provisional`, `denied`). State-aware master toggle.
Cold-start hydration from AsyncStorage + async resolution.
In-flight ref gate. Install-after-uninstall pre-check.

The only round-7 addition: when permission goes `granted → denied`,
also DELETE the `device_tokens` row (or mark it inactive). Belt-and-
suspenders alongside Expo's `DeviceNotRegistered` response handling.

---

### Q13: Re-engagement source — *server-side*

*Trigger logic unchanged from round 5c.* User inactive 14+ days,
no foreground in that window, single-shot per quiet period.

Server-side implementation: the cron query (above) already includes
the re-engagement branch. `last_foregrounded_at` is updated by the
client on every foreground; `last_re_engagement_fired_at` is set by
the edge function when it sends the push, and reset implicitly when
`last_foregrounded_at > last_re_engagement_fired_at` (the user
returned).

Body: *"It's been a while. Come build your memorization habit."*

Tap target: per Q8.

`last_foregrounded_at` initialization: set to `now()` on first
INSERT into `notification_preferences` (DB default), so day-1
sign-in doesn't trigger re-engagement.

---

### Q14: Settings tab badge — *unchanged*

"1" badge appears when:
- Q1 explainer card has been dismissed AND not currently mounted.
- iOS permission status is `undetermined` OR `denied`.
- User has at least 1 verse in their library.

Disappears on first Settings visit; one-time discovery hint.

---

### Q15: Per-source fire timing

| Source | Fire time | User-configurable? |
|---|---|---|
| Reviews digest | 9:00 am local default; cadence daily or weekly-Mon-Sun | **Yes** |
| In-progress | 6:00 pm local Mondays | Time only (cadence locked at weekly) |
| Re-engagement | 12:00 pm local | No (invisible) |

In-progress trigger gates *(now server-side, addresses round-6 I14)*:
- ≥1 in-progress verse with `bestAccuracy != null`.
- AND user has not foregrounded in last 24h (`now() -
  last_foregrounded_at >= INTERVAL '24 hours'`).
- Frequency: weekly cadence (one push per week max).

The 24h-skip is checked **at fire time** by the edge function. Round
6's bug (calendar-trigger checks at schedule time only) is gone.

---

### Q16: ~~Trigger types / DST / TZ~~ *(obsolete)*

No client-side triggers, so no `DateTriggerInput` vs
`CalendarTriggerInput`. Server cron in user's IANA timezone handles
TZ + DST natively (PostgreSQL `now() AT TIME ZONE 'America/Los_Angeles'`
auto-evaluates against the OS tzdata, including DST transitions).

**Travel:** when the user travels, the client updates
`notification_preferences.timezone` on next foreground. Future cron
passes use the new TZ. The verse mid-interval edge case from round
6 (PST midnight → 3am EDT artifact) is gone — server polls every
minute, so a verse becomes due (in UTC) at the right instant
regardless of TZ.

**TZ update logic on client:** every app foreground, compare
`Intl.DateTimeFormat().resolvedOptions().timeZone` against the
cached TZ in Zustand. If different, UPDATE
`notification_preferences.timezone`. Cheap (one-time check per
foreground).

---

### Q17: Testing strategy

**Two new layers vs round 6:**

1. **Server-side unit tests** for the edge function:
   - The "users matching this minute" SQL query — feed it fixed
     `now()`, fixed pref rows, assert correct user IDs returned.
     Cover daily/weekly cadence, DST transitions, 14d-inactive
     branch.
   - Body composition functions — given a list of due verses,
     produce the expected body string.
2. **Manual cron test in dev:** invoke the edge function with a test
   user ID (`/functions/v1/send-notifications/test`) and verify the
   push arrives. Skip the cron entirely; verify the function
   end-to-end.

**Client testing** simplifies dramatically:
- No reconcile logic to test.
- Permission flow (Q12) — same coverage as round 6.
- Settings UI — toggles + pickers write to Supabase; assert correct
  row state.
- Tap deep-link — same as round 6.

**Dev menu** *(carries forward from round 5b)*:
- "Fire my Reviews digest now" → invoke edge function with user's ID
  and a `force = true` flag that bypasses the time-match check.
- "Fire my In-progress now" → same.
- "Show my prefs" → dump current `notification_preferences` row.

**Real-device sanity test before ship:** master a verse, set digest
fire-time to 1 minute from now, wait, verify push arrives with
correct body, tap, verify deep-link.

---

### Q18: Extensibility contract — *adapted for server-side*

Adding a new source is now a backend-leaning change:

1. Add a column to `notification_preferences` for any per-source
   prefs (nullable, default-able — invariant 11).
2. Add a branch to the edge function's "users matching this minute"
   SQL query.
3. Add a body-composition function in the edge function file.
4. Add a deep-link target case in `lib/notifications/deep-links.ts`.
5. Add a Settings UI toggle (or skip if invisible).
6. Add copy entries to `lib/notifications/copy.ts` (still used for
   client-side fallback / preview, e.g. dev menu).

Hard rules (similar to round 5b but server-adjusted):
- All push sending goes through the edge function. Client never
  POSTs to Expo Push directly.
- Sources MUST NOT make cross-table joins outside the standard
  ownership pattern (always filter by `user_id`).
- The edge function MUST handle Expo Push response errors:
  `DeviceNotRegistered` → DELETE the token row.
  `MessageRateExceeded` → exponential backoff (Expo recommends).
  `InvalidCredentials` → log + alert.

---

## Technical sketch

```
lib/notifications/
├── index.ts              # public API: hooks
├── types.ts              # Preferences, push response types
├── api.ts                # Supabase client wrappers (writes go here)
├── preferences.ts        # AsyncStorage cache + Zustand slice
├── permissions.ts        # request flow, four-state UI
├── tokens.ts             # device token registration + refresh
├── deep-links.ts         # response handler
├── copy.ts               # client-side copy (preview, dev menu)
└── debug.ts              # __DEV__-only dev menu

supabase/
├── migrations/
│   └── 017_notification_system.sql
└── functions/
    └── send-notifications/
        ├── index.ts       # edge function entry (Deno)
        ├── sources/
        │   ├── reviews-digest.ts
        │   ├── in-progress.ts
        │   └── re-engagement.ts
        ├── push.ts        # Expo Push client
        └── types.ts
```

Hook surface:

```ts
useNotificationPreferences()    // hydrated from AsyncStorage, synced to Supabase
useNotificationPermission()     // { status, request, openSettings }
useNotificationSettingsBanner() // boolean (Q14 badge)
```

Internal:

```ts
api.upsertDeviceToken(token)
api.updatePreferences(patch)
api.updateLastForegroundedAt() // debounced
```

## Edge cases to verify during build

- ⚠️ **DST transitions.** PostgreSQL `now() AT TIME ZONE 'America/...'`
  handles them natively. Verify with a unit test: at 1:30am during
  fall-back (1am happens twice), does the cron fire the user's 1:30am
  digest twice? Or zero times? PostgreSQL returns the first
  occurrence; we should verify and document.
- ⚠️ **TZ rename / removal.** IANA names like `Europe/Kiev` get
  renamed (`Europe/Kyiv`). PostgreSQL keeps both as aliases for now,
  but a future tzdata update could break us. Defensive: if `now() AT
  TIME ZONE np.timezone` raises, log + treat as UTC for that pass.
- ⚠️ **User on the move with stale TZ.** User flies LAX → JFK, doesn't
  open the app for 3 days. Server still thinks they're in PST. Their
  9am digest fires at 9am PST = 12pm EDT. Mild artifact; corrects on
  next foreground.
- ⚠️ **Token rotation mid-flight.** Expo rotates a token between
  foreground and the next cron pass. Old token returns
  `DeviceNotRegistered`; edge function deletes it. User gets nothing
  this pass; next foreground re-registers. Acceptable.
- ⚠️ **Cron lateness.** pg_cron occasionally fires a few seconds late.
  If the function runs at 9:00:03, does it match users at 9:00 or
  9:01? Match against minute-of-now, not minute-of-scheduled-time.
  Acceptable jitter.
- ⚠️ **Edge function timeout.** Supabase edge functions have a 150s
  default timeout. At 100K MAU we'd push to ~70 users/min — well
  within. At 1M+ MAU we'd batch. Not a v1 concern.
- ⚠️ **Duplicate sends if cron over-fires.** pg_cron sometimes
  re-runs after a Supabase outage. Idempotency: edge function checks
  `last_*_fired_at` before sending and updates in the same
  transaction. Worst case: a user gets a duplicate push. Acceptable.
- ⚠️ **First-launch token registration timing.** User signs in,
  permission card appears, taps Enable, iOS prompt fires, grants.
  Now we need `Notifications.getExpoPushTokenAsync()` *and* an INSERT
  into `device_tokens`. If the network is slow, the user could
  background before INSERT lands. On next foreground, retry token
  registration if `device_tokens` lookup returns 0 rows.

## What this feature explicitly will NOT add

- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- Notifications on web (Bread doesn't currently support push to web;
  `expo-notifications` web is no-op).
- Cross-device dismissal (user reviews on iPad → cancel push to
  iPhone). Requires per-token-per-verse delivery state we don't
  keep. Possible v2.
- A/B testing copy variants (server-trivially-addable later).

---

## Action Items

- [ ] **Agent review of round-7 rewrite.** Diff vs commit `c993cab`
      (round-6 baseline) reviewed exhaustively.
- [ ] **Confirm Expo Push Service is the right transport.** Doc
      defaults to it; if the build agent or Caelan wants OneSignal
      or Direct APNs instead, swap one edge-function file.
- [ ] **Decide deep-link target route.** Either add
      `?reviewView=true` to library or repoint to
      `/(tabs)/(library)/mastered`. (Carries over from round 6 C2.)
- [ ] **Promote doc to `building`** once review feedback resolved.
      Fill in full Technical Approach (file-by-file) and Build
      order (PR-sized chunks).

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Original stub created, review-only scope. | Split from review-system doc. |
| 2026-04-28 | Reframed as multi-source platform. | Extensibility ask. |
| 2026-04-28 | v1 ships 3 sources: review-due, in-progress, re-engagement. | Validates platform abstraction. |
| 2026-04-28 | Permission asked via in-app explainer card after sign-in. | iOS one-shot; explainer is conventional. |
| 2026-04-28 | Verse references in body, not full text. | "Just a Bible verse" — no privacy concern. |
| 2026-04-28 | Notification taps land on a list, never auto-start. | Auto-start is intrusive. |
| 2026-04-28 | Round 3 — generic explainer card, one-time, AsyncStorage-managed. | Don't nag. |
| 2026-04-28 | Round 3 — re-engagement = Option B, 14-day, single-shot. | Channel of last resort. |
| 2026-04-28 | Round 3 — Q14 Settings tab nudge badge. | Discovery for card-dismissers. |
| 2026-04-28 | Round 3 — suppress in foreground. | Caelan: don't care for in-app. |
| 2026-04-29 | Round 4 — re-engagement is invisible plumbing. | Don't expose a toggle for the safety net. |
| 2026-04-29 | Round 4 — In-progress trigger: every 7 days, ≥1 in-progress, 24h activity skip. | Weekly habit; don't nag active users. |
| 2026-04-29 | Round 5 — Reviews fired at exact `nextDueAt` (per-verse local). | Killed 9am digest holdover. |
| 2026-04-29 | ~~Round 5 — hard-cap 60 pending, earliest-due-first.~~ **Superseded round 6.** | Per-verse model needed cap math. |
| 2026-04-29 | Round 5b — preferences device-level. | Matched `colorMode`/`bibleVersion`. |
| 2026-04-29 | Round 5b — Q17 testing: dev menu + time-shift + unit tests. | Iteration loop. |
| 2026-04-29 | Round 5b — Q18 extensibility: 6-step recipe + hard rules. | Platform contract. |
| 2026-04-29 | Round 5c — Concurrent reconcile gate spec'd. | Race-condition mitigation. |
| 2026-04-29 | Round 5d — Q12 four states (added `provisional`); cold-start hydration. | Agent audit findings. |
| 2026-04-29 | **Round 6 — switch from per-verse local to daily digest local.** | Heavy-user future-proof. |
| 2026-04-29 | ~~**Round 6 — `nextDueAt` rounds down to local midnight.**~~ **Superseded round 7.** | Server polls every minute; midnight-snap unnecessary. |
| 2026-04-29 | ~~**Round 6 — single trigger type (`CalendarTriggerInput`).**~~ **Superseded round 7.** | No client triggers in round 7. |
| 2026-04-29 | **Round 7 — switch from local to server-side push via Expo Push Service.** | Personalized fresh-at-fire-time body is the product (Caelan: "personalized means just writing the verse, otherwise the notification is gonna look really bland"). Local notifications fix body at schedule time; only server push delivers fresh body. Also resolves round-6 I17 (foreground-only-reconcile + casual-user gap) structurally. |
| 2026-04-29 | **Round 7 — transport: Expo Push Service.** | Free; 600/sec rate cap is effectively unbounded for Bread. Already in stack. Migration to OneSignal or Direct APNs later is one edge-function file change. |
| 2026-04-29 | **Round 7 — Supabase pg_cron every minute + edge function.** | Bread already uses pg_cron (`010_popular_verses`, `011_user_stats_cron`). Same pattern. Minute-resolution matches user's pickable fire-time precision. |
| 2026-04-29 | **Round 7 — preferences are account-level (Supabase row), not device-level.** | Reverses round 5b/6 device-level. Account switch on shared device now correctly switches notification prefs. Strict UX improvement. AsyncStorage is now a cache, not source of truth. |
| 2026-04-29 | **Round 7 — additive-only schema, no edits to existing tables.** | CLAUDE.md invariant 11. Old clients in App Store rollout window receive zero notifications (safe failure). |
| 2026-04-29 | **Round 7 — IANA timezone stored per user; PostgreSQL handles DST natively.** | `now() AT TIME ZONE np.timezone` evaluates against OS tzdata. No client TZ math. |
| 2026-04-29 | **Round 7 — In-progress 24h-skip checked at fire time, server-side.** | Fixes round-6 I14 (calendar-trigger checked at schedule time only). |
| 2026-04-29 | **Round 7 — body composed fresh at fire time.** | The whole point of switching to server. Round-6 staleness scenarios (deleted verse named in body) are impossible by construction. |

## Next step

1. Agent review of this rewrite (Action Items #1).
2. Resolve review findings.
3. Promote `planning` → `building`. Fill Technical Approach + Build
   order.
