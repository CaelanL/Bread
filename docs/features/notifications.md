# Notifications

Scheduled reminders pushed to a user's iOS device. `pg_cron` calls an edge function
every minute, the function works out who is due this minute, and Expo Push Service
delivers. The client only registers tokens, stores preferences and keeps the timezone
and heartbeat current.

iOS only. `getPermissionStatus` returns `undetermined` on any other platform.

## Sources

Each source has its own switch, cadence (daily, or weekly on one weekday) and
wall-clock time. `master_enabled` gates both.

| | Reviews digest | In-progress nudge |
|---|---|---|
| Sends when | Any mastered verse is due | Any in-progress verse exists, and no foreground in the last 24h |
| Default | Daily, 9:00 AM | Mondays, 6:00 PM |
| Title | `Review time` | `Keep going` |
| Body | `<ref> is ready for review.` or `<ref> and N more ready for review.` | `<ref> is waiting — pick up where you left off.` |
| Named verse | Earliest `nextDueAt`, nulls first, then oldest `created_at`, then `id` | Latest `last_practiced_at`, nulls last, then newest `created_at`, then `id` |
| Payload `target` | `mastered` | `in-progress` |

Bodies use the reference only, never Bible text. Both can fire in the same minute.

**Due** in `loadDueVerses`: `hard.completed` is true, `deleted_at` is null, and
`engraved.nextDueAt` is null or past. Due dates snap to local midnight
(`nextDueAfterDays` in `lib/store/review.ts`), so a digest at any time on the due day
catches the verse. Review rules are in `docs/features/review.md`.

**In progress** in `loadInProgressVerses` mirrors `isInProgressVerse` in
`lib/store/index.ts`: any non-null `bestAccuracy` and not mastered on Hard. Change them
together, or users get nudged about verses the In Progress collection doesn't show.

## When a user matches

`supabase/functions/send-notifications/index.ts` runs `dispatchReviewsDigest`, then
`dispatchInProgress`. Each loads every row with its switches on and matches in
TypeScript: `localTimeInTz` in `sources/_shared.ts` converts now to the stored IANA
timezone with `Intl`. A user matches when:

1. The local hour and minute equal the stored ones exactly.
2. For weekly cadence, the local weekday equals the stored one (0 is Sunday).
3. `*_last_fired_local_date` is earlier than today's local date.
4. In-progress only: `last_foregrounded_at` is at least 24h old.

Each matched user runs in a try/catch, so one bad row can't stop the pass.

| Outcome | `notification_log.status` | Stamps last-fired |
|---|---|---|
| Nothing to send | `skipped-empty`, no body | Yes |
| No device tokens | `skipped-empty`, with body | Yes |
| At least one token accepted | `sent` per token, with `expo_ticket` | Yes |
| Every token failed | `token-error` or `send-error` per token | No |

The stamp stops double sends on the repeated hour at DST fall-back and on cron over-fire.

## Tables

Created in `supabase/migrations/017_notification_system.sql`, with in-progress cadence
from `019_in_progress_cadence.sql`. Schema is in `docs/architecture/data-model.md`.

**`device_tokens`** has one row per device. `UNIQUE(expo_token)` is on the token alone,
so an upsert moves the row to whoever signed in. A compound key with `user_id` would let
two rows exist for one device, and User A's references would reach User B.

**`notification_preferences`** has one row per user. These CHECKs are load-bearing:

- `*_hour BETWEEN 1 AND 23`. 12 AM isn't allowed.
- Cadence and weekday are coupled: `daily` with null, or `weekly` with a weekday.
  `buildPatch` in `app/notifications.tsx` always sends the pair.
- `timezone` is `NOT NULL` with no default. A `UTC` default would mistime pushes until
  the first client update.

`in_progress_cadence` and `in_progress_weekday` default to `weekly` and `1`, which pass
the CHECK together, so an insert that doesn't name them is valid. Migration order is
invariant 11 in `docs/architecture/data-model.md`. Here, a column the function selects
must be applied first, because a missing column fails that source's whole query.

**`notification_log`** answers "why didn't I get a notification". Users can read their
own rows and the function writes with the service role.

## Cron and auth

Migration 017 enables `pg_net` and schedules `send-notifications` (`* * * * *`) and
`prune-notification-log` (`0 3 * * *`, deletes log rows older than 30 days).

The first job sends `cron_secret` from Vault as a bearer. A `DO $$` guard fails 017 if
the secret is missing, which beats a silent 401 every minute. Bootstrap it once first:

```sql
SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
```

The function has `verify_jwt = false` in `supabase/config.toml`, so the bearer is its
only gate. `authenticateCron` compares with `timingSafeEqual`. It reads the secret through
the `public.get_cron_secret()` RPC from `018_notification_system_fixups.sql`, granted to
`service_role` only, because PostgREST won't expose the Vault schema. The secret is cached
per warm container and re-read once on a mismatch, so rotation needs no recycle.

`push.ts` sends one message per token and needs the `EXPO_ACCESS_TOKEN` function secret.
`DeviceNotRegistered` becomes `token-error`, and `sendToAllTokens` deletes that row.
Everything else becomes `send-error`. Delivery receipts aren't polled. Function conventions
are in `docs/architecture/edge-functions.md`.

## Client: `lib/notifications/`

| File | Holds |
|---|---|
| `api.ts` | Every client read and write of the two tables (invariant 1). Also `defaultPreferences`, which must match the migration defaults |
| `preferences.ts` | `usePrefsStore`, cached in AsyncStorage. The server wins on `hydrate`. `patch` is optimistic with rollback |
| `permissions.ts` | `getPermissionStatus`, `requestPermission`, `openOsSettings`. `provisional` counts as granted |
| `tokens.ts` | `registerDeviceToken`, with a local cache of the last token |
| `foreground.ts`, `deep-links.ts` | `syncForegroundState`; `registerDeepLinkHandler`, `replayColdStartTap` |
| `uxFlags.ts`, `useSettingsBadge.ts` | Card and badge flags, device-local and kept across sign-out |
| `debug.ts` | `installDevTools`. No "fire now" helper, since it would bundle the cron secret |

Prefs are per account. `app/_layout.tsx` hydrates them and runs `syncForegroundState` on
sign-in, runs the sync again on each background-to-active change, and clears the cache on
sign-out. Its `setNotificationHandler` turns everything off, so a push arriving while the
app is open shows nothing.

`syncForegroundState`, in order:

1. If `denied`, delete this device's token row and the local cache.
2. If granted or provisional, call `registerDeviceToken`. If that returned a token and no
   prefs row is loaded, insert defaults. This covers enabling from iOS Settings.
3. If a row is loaded and the device timezone differs, update `timezone`.
4. Call `updateLastForegroundedAt`, filtered to rows older than 5 minutes.

A user who never grants permission has no prefs row, so the cron never sees them.

## Asking for permission

iOS shows its dialog only once, from `undetermined`, so the app explains first.

`components/notifications/Q1ExplainerCard.tsx` appears once after sign-in when the status
is `undetermined`. **Enable** requests permission, registers the token and inserts defaults
if there's no row. **Maybe later** only sets the flag. `app/dev-sign-in.tsx` also sets it,
because the card would cover every simulator screenshot.

`useSettingsBadge` puts a "1" on the Settings tab when flags are hydrated, the card was
dismissed, Settings hasn't been visited, permission is `undetermined` or `denied`, and the
user has a verse. Opening Settings clears it for good through `markSettingsVisited`. Keep
the hook false until every gate resolves, or it flickers on cold start.

## Settings page: `app/notifications.tsx`

Reached from the row in `app/(tabs)/settings.tsx`, which reads "On" only if `masterEnabled`
is true and permission is granted or provisional. Edits stay in a local draft until Save,
so a stray toggle never reaches the server.

- **Seeding.** The draft starts from the loaded row, or `defaultPreferences`. If prefs arrive
  after mount, `baseline` updates, and `draft` updates only if the user hasn't edited.
- **Master switch.** From `undetermined`, turning it on requests permission immediately,
  because by Save the dialog could no longer show. From `denied`, the row opens iOS Settings.
  From granted, it's a draft edit. Source sections show only when granted and master is on.
- **Save.** `handleSave` re-reads `usePrefsStore.getState().prefs` and re-probes permission,
  since a stale null would INSERT over an existing row. With master on and no permission, it
  alerts instead. With no row it inserts defaults and patches the difference. With a row it
  patches the difference.
- **Back.** Unsaved changes ask to discard. `isDirty` ignores `timezone`, which
  `syncForegroundState` owns.

`NotificationTimeModal` offers 5-minute steps and disables Save on 12 AM.
`NotificationCadenceModal` offers Daily or one weekday.

## Tapping a push

`deep-links.ts` validates `source` and `target`, then pushes `/(tabs)/(library)/mastered` or
`/(tabs)/(library)/in-progress`. A tap never starts a session. Mastered defaults to Due first
unless the user chose another sort (`docs/features/library.md`). A tap that launched the app
waits for `replayColdStartTap`, which `app/_layout.tsx` calls once authenticated and mounted.

## Local development

Migration 017 schedules its call to the hosted URL. `supabase/seed.sql` unschedules that job,
so a local database never calls prod and no push fires by itself. `supabase/config.toml` puts
a local-only `cron_secret` in Vault so 017 can apply.

## Sharp edges

- **The token cache breaks account switching on one device.** `registerDeviceToken` skips the
  upsert when the token equals the cached one, and sign-out never calls `clearCachedToken`. If
  User B signs in where User A was, the row stays on A: A's reminders reach this device and B
  gets none. For the same reason, a row deleted on the server isn't recreated while the cache
  holds that token.
- **Sign-out keeps the token row.** A signed-out device keeps receiving that account's pushes.
- **No catch-up and no retry.** The match needs the exact minute. If cron misses it, or every
  token fails, nothing goes out until the next scheduled day. A 2:30 AM time doesn't fire on
  the spring-forward day. A weekly nudge skipped by the 24h gate waits a week.
- **Revoking permission in iOS Settings doesn't change `master_enabled`.** The cron still
  matches, then logs `skipped-empty` once the token row is gone. Settings reads "Off" anyway.
- **The digest skips soft-deleted mastered verses, but the app doesn't.** The Mastered list and
  `useDueCounts` include them, so the app can show more due verses than the digest.
- **An invalid timezone skips the user** until the client fixes it on the next foreground. The
  SQL helper `local_time_in_tz`, with its UTC fallback, exists but nothing calls it.
- **Enabling with no edits can't Save.** With no row, the draft already has master on, so
  turning the switch on leaves the page clean. The row arrives on the next foreground sync.
- **`rowToPrefs` turns a null weekday into 1.** That fallback also hits daily rows, so re-saving
  Daily in the in-progress cadence modal marks the page dirty. Writes stay valid.
- **pg_net housekeeping.** The per-minute `net.http_post` from migration 017 leaves rows in
  `net._http_response`. pg_net versions before 0.20.3 didn't report worker statistics, so
  autovacuum may not clean that table ([upstream fix](https://github.com/supabase/pg_net/pull/254)).

## Browser checks

- `npm run sim -- shot /notifications --as reader-a`: grey Save. With permission not yet granted, the switch is off, it reads "Tap to allow review reminders", and no source sections show.
- `npm run sim -- shot /settings --as reader-a`: the Notifications row reads "Off".
- Tap path on the simulator: Settings, Notifications, turn the switch on, allow. Reviews show Daily and 9:00 AM, the nudge shows Every Monday and 6:00 PM, and Save stays grey until you edit.
- Real device, with a mastered verse due: set the review time to the next 5-minute mark, Save, lock. A "Review time" push arrives on that minute, and tapping it opens Mastered.

## Decisions

- 2026-04-28 · Permission is asked through an in-app card · The iOS prompt can only fire once, so explain first.
- 2026-04-28 · Taps land on a list, and pushes are suppressed while the app is open · Auto-start is intrusive, and a reminder isn't useful inside the app.
- 2026-04-29 · One digest per user from the server, through Expo Push and per-minute `pg_cron` · Per-verse local notifications hit the iOS pending cap, and only a server push has a body that's accurate when it fires.
- 2026-04-29 · Two sources, no re-engagement push · In-progress covers users with something to do. Anything else is marketing.
- 2026-04-29 · `UNIQUE(expo_token)` alone · A compound key lets one user's verses reach another. The token cache currently undercuts this; see Sharp edges.
- 2026-04-29 · Earliest selectable time is 1:00 AM · Product call, enforced by the schema.
- 2026-04-29 · Match in TypeScript, loading all enabled rows · Simple at this size. Move to a `SECURITY DEFINER` RPC at a few thousand rows.
- 2026-04-30 · In-progress gets the same cadence picker as reviews · UI parity. Column defaults keep the Monday behavior for rows that never choose.
