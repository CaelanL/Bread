# Notifications

> **Status: Living document.** Update when the notification surface
> changes — new sources, schema changes to `notification_preferences`
> or `device_tokens`, or the foreground/permission/dispatch flow.
> Read before touching `lib/notifications/`, `app/notifications.tsx`,
> `supabase/functions/send-notifications/`, or migrations 017–019.
>
> Historical "why" lives in `docs/features/notification-system.md`
> (the original design doc, preserved as a shipped feature record).

## Shape at a glance

The system pushes scheduled reminders to a user's iOS device using
**Expo Push Service** as the courier and **pg_cron + an edge
function** as the trigger. There are two notification sources:

1. **Review reminders** — fires when the user has mastered verses
   due for spaced-repetition review.
2. **In-progress nudge** — fires when the user has started but not
   yet mastered verses, AND hasn't foregrounded the app in 24h.

Both are independently togglable, with their own cadence
(daily / weekly+weekday) and wall-clock time. A master toggle gates
both. iOS only for v1; Android is a separate v2 effort.

```
┌───────────────────────┐    every minute    ┌──────────────────────┐
│   pg_cron (Postgres)  │ ─────HTTP POST───▶ │  send-notifications  │
│  cron_secret in Vault │     bearer auth    │   (Edge Function)    │
└───────────────────────┘                    └──────────┬───────────┘
                                                        │
                              ┌─────────────────────────┼─────────────────────────┐
                              ▼                         ▼                         ▼
                    ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
                    │ reviews-digest  │       │   in-progress   │       │ notification_log│
                    │     source      │       │     source      │       │  (audit/debug)  │
                    └────────┬────────┘       └────────┬────────┘       └─────────────────┘
                             │                         │
                             └────────┬────────────────┘
                                      ▼
                          ┌──────────────────────┐
                          │  Expo Push Service   │
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │     User's iOS       │
                          │       device         │
                          └──────────────────────┘
```

## Tables

Three tables, all created in migration `017_notification_system.sql`
plus `019_in_progress_cadence.sql` (in-progress cadence parity).

### `device_tokens`

One row per (user, device). `UNIQUE(expo_token)` makes ownership
transfer atomic via UPSERT — if User B signs in on a device that
previously belonged to User A, the row's `user_id` flips. Compound
`(user_id, expo_token)` would let two rows coexist for one device,
which would cause cron pushes for User A to land on a device User B
is now using → privacy leak.

### `notification_preferences`

One row per user (`user_id` PK). Stores the master toggle, both
sources' enable/cadence/weekday/hour/minute, the user's IANA
timezone, the `last_foregrounded_at` heartbeat, and per-source
`*_last_fired_local_date` for idempotency.

Schema CHECKs are load-bearing:
- `reviews_hour BETWEEN 1 AND 23` (and same for in-progress) —
  forbids 12 AM. The client TimeModal enforces this; the schema
  is the backstop.
- `(cadence='daily' AND weekday IS NULL) OR (cadence='weekly' AND
  weekday IS NOT NULL)` — coupled CHECK on both sources. The page's
  `buildPatch` always sends both fields together.

### `notification_log`

Append-only audit log. Captures `sent`, `skipped-empty`,
`token-error`, `send-error` with body and Expo ticket ID. Pruned by
a separate cron (rows older than 30 days). Useful for debugging
"why didn't I get a notification."

## Auth boundary: Vault + cron secret

The cron-to-edge-function call uses a bearer secret stored in
Supabase Vault as `cron_secret`. The edge function reads it via a
`SECURITY DEFINER` RPC `public.get_cron_secret()` (granted to
`service_role` only) — direct `.schema('vault').from(...)` queries
don't work on Supabase Cloud (PostgREST schema allowlist plus
service_role lacks the SELECT grant).

Bootstrap is one-time, manual:
```sql
SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
```
Migration 017 has a `DO $$ ... $$` guard that fails the deploy
loudly if this wasn't done — preferable to a silent 401 every
minute.

## Client module: `lib/notifications/`

Public surface (re-exported from `lib/notifications/index.ts`):

| Symbol | Purpose |
|---|---|
| `useNotificationPreferences()` | Zustand selector returning the cached prefs row, or `null` if not yet hydrated. |
| `usePrefsStore` | Direct Zustand store access — used by the Save handler in `app/notifications.tsx` to re-read state after an optimistic patch. |
| `defaultPreferences(tz)` | Single source of truth for the default row shape. Mirrored on the server by `insertDefaultPreferences` and migration column DEFAULTs. |
| `hydratePreferences()` / `clearPreferences()` | Sign-in / sign-out hooks. |
| `initializeDefaults(tz)` | INSERT the user's first prefs row. |
| `patchPreferences(diff)` | Optimistic UPDATE with rollback. |
| `getPermissionStatus()` / `requestPermission()` / `openOsSettings()` | iOS permission flow. |
| `registerDeviceToken()` | Get the Expo push token, UPSERT into `device_tokens`. |
| `syncForegroundState()` | TZ resync + `last_foregrounded_at` heartbeat + token refresh. Called on every foreground. |
| `registerDeepLinkHandler()` / `replayColdStartTap()` | Tap-to-route. |
| `useSettingsBadge()` / `markSettingsVisited()` | Q14 "1" badge logic on the Settings tab. |
| `useUxFlagsStore` | Q1-dismissed and settings-visited flags, AsyncStorage-backed. |
| `installDevTools()` | `__DEV__` console helpers. |

Per CLAUDE.md invariant 1, **all writes** to `device_tokens` and
`notification_preferences` go through `lib/notifications/api.ts`.
Components and screens never touch supabase directly for these tables.

## Settings UI: commit-on-Save

`app/notifications.tsx` is a dedicated page (not inline rows on
Settings) so the user can edit every field as a *draft* and only
commits to the server on Save. This protects against accidental
toggle-flips writing to the server.

Important behaviors:

- **Draft seeding** uses `defaultPreferences(deviceTimezone())` if no
  server row exists yet, else the live prefs row.
- **Late hydrate** — if prefs are still null at mount and arrive
  later, the page reseeds *baseline* but only reseeds *draft* if the
  user hasn't started editing. Otherwise the user's edits would be
  clobbered.
- **`handleSave`** re-reads prefs from the live store at the top of
  the handler; the closure capture is stale if hydrate completed
  between render and Save. Branching on stale null would run the
  INSERT path against an existing row → primary-key conflict.
- **iOS permission is one-shot** — `requestPermissionsAsync()` only
  triggers the OS dialog when status is `undetermined`. The master
  toggle's "undetermined → ON" transition uses a *live* request,
  not a draft, because by Save-time the dialog can no longer fire.
- **Permission denied + master ON drafted** — Save bails with an
  Alert that routes to iOS Settings. Save will not write
  `master_enabled=true` against a denied permission.
- **Back-with-dirty** — prompts Discard alert. Compares draft
  against baseline; doesn't include `timezone` (foreground sync
  owns it).

The Settings tab shows a `Notifications  On/Off  ›` row that
navigates to the page. "On" iff `master_enabled=true` AND
permission is granted/provisional. Permission-denied always
summarizes as "Off" even if the row says master is on.

## Edge function: `supabase/functions/send-notifications/`

`index.ts` is the cron-fired entrypoint: validates the bearer,
dispatches to `sources/reviews-digest.ts` and `sources/in-progress.ts`
sequentially, returns 200.

Each source does:
1. Pull all prefs rows where `master_enabled=true` and the source's
   `*_enabled=true`.
2. Per-row, evaluate `localTimeInTz()` against the user's stored
   hour/minute and (for cadence=weekly) weekday.
3. Check the per-source `*_last_fired_local_date` for idempotency
   (DST fall-back, cron over-fire after outage).
4. For in-progress only: also check the 24h-active gate via
   `last_foregrounded_at`.
5. Build the message body, push to all of the user's tokens via
   `push.ts`, log the result.

`push.ts` handles Expo Push API error codes:
`DeviceNotRegistered` → delete the token row.
`MessageRateExceeded` → log, don't retry this minute.
`InvalidCredentials` → log, fail loudly (config issue).

## SQL parity: in-progress predicate

The in-progress source's `loadInProgressVerses` mirrors
`isInProgressVerse` at `lib/store/index.ts:1043`. The predicate is
*lenient* — any non-null `bestAccuracy` on any difficulty AND not
yet mastered on Hard. Both sides must stay in sync; otherwise
users get nudged about verses the in-app collection doesn't show,
or vice versa. `lib/store/index.ts` has a comment cross-referencing
the SQL site.

## Migration safety (invariant 11)

The notification migrations (017, 018, 019) are designed for
"old client + new schema" safety per CLAUDE.md invariant 11:

- **017** — entirely additive (new tables only). Old clients don't
  touch them, so they're unaffected.
- **018** — fixups (RPC for vault read, function volatility).
  No schema changes.
- **019** — adds two columns (`in_progress_cadence`,
  `in_progress_weekday`) to `notification_preferences`. Both have
  DEFAULTs that satisfy the new compound CHECK *on their own*
  (`'weekly'` + `1`), so an old-client INSERT that doesn't
  reference the new columns lands a CHECK-passing row. The new
  client's row mapper has `?? 'weekly'` and `?? 1` fallbacks for
  reads against an un-migrated DB.

**Deployment order matters** for 019: `supabase db push` must run
before the updated edge function deploys, because the function's
new SELECT references `in_progress_cadence` and
`in_progress_weekday`. Reverse order = silent cron errors until
the migration applies.

## Sharp edges

- **`master_enabled=true` + iOS permission revoked OOB.** If a user
  disables iOS notifications in Settings without coming back to the
  app, the cron still matches them and Expo will return
  `DeviceNotRegistered`. `push.ts` cleans up the token row, but the
  prefs row stays `master_enabled=true`. On next foreground,
  `syncForegroundState` re-probes permission and could be made to
  reconcile this — currently it doesn't. See chunk-6 polish list.
- **TZ change while the page is open.** The page seeds `timezone`
  once at mount but excludes it from the patch — `syncForegroundState`
  owns TZ. Save during a TZ change won't write a stale TZ.
- **Q14 badge can flicker during cold start.** It depends on
  AsyncStorage hydration + permission probe + verse count from the
  store. Until all three resolve, the hook returns false. If you
  add another gate, keep this short-circuiting model.
