# Notification System — Build Plan

> **Companion to:** `docs/features/notification-system.md` (the design doc).
> **Status:** `building`
> **Author:** Caelan
> **Created:** 2026-04-29
>
> The design doc is the *what* and *why*. This is the *how* and *in
> what order*. If a future agent picks up mid-build, this doc is the
> entry point: it tells you which chunks are done, which is next, and
> what each chunk leaves the system in.

## Workflow

This feature is being built as **6 commits on a single PR branch**
(`feat/notification-system-rewrite`). After each chunk:

1. The chunk is implemented locally; nothing is committed yet.
2. A fresh agent reviews the unstaged diff. Clean review surface, no
   prior-conversation bias.
3. If anything is testable on device/simulator, the user tests it.
   Otherwise the agent says so explicitly — no busywork tests.
4. Findings are folded back into the diff.
5. The chunk is committed with a focused message.
6. Next chunk begins.

The goal is each commit lands the system in a runnable state, so
`git revert <hash>` is always a clean undo.

## Why this commit shape

The design doc's "Next steps" suggests 3 PRs. We're collapsing to one
PR with 6 commits because:

- Solo engineer — every PR is a context-switch tax (CI, branch dance,
  merge ordering).
- Six commits give the same review granularity as six PRs without the
  operational cost.
- A reviewer can read the commit list in order; each diff is small.

## Chunk plan

### Chunk 1 — Backend infrastructure

**Files:**
- `supabase/migrations/017_notification_system.sql` — full migration
  per design doc (tables, RLS, Vault guard, cron schedule, log-prune
  cron, `local_time_in_tz` helper).
- `supabase/config.toml` — add `[functions.send-notifications]`
  with `verify_jwt = false`.
- `supabase/functions/send-notifications/index.ts` — auth skeleton
  only. Validates the cron-secret bearer (constant-time), logs the
  authenticated pass to stdout, returns 200. No source dispatch yet,
  no `notification_log` writes (those land in chunk 2 alongside the
  sources that produce them).
- `supabase/functions/send-notifications/types.ts` — shared types.
- `supabase/migrations/018_notification_system_fixups.sql` — added
  during chunk-1 review to fix two real issues: a SECURITY DEFINER
  `public.get_cron_secret()` RPC (the direct
  `.schema("vault").from(...)` pattern doesn't work on Supabase
  Cloud — service_role lacks the grant and PostgREST blocks the
  schema), and `local_time_in_tz()` re-marked `STABLE` instead of
  `IMMUTABLE` (it calls `now()`).

**What this proves:** cron fires, function authenticates the bearer
against the Vault secret, returns 200. Zero pushes go out, no DB
writes (no source logic yet).

**Testing:**
- Apply migrations (`supabase db push`).
- Verify Vault bootstrap fails the deploy if skipped (the `DO $$`
  guard in 017 raises with the exact bootstrap command).
- Check Supabase Functions Logs dashboard shows
  `[notifications] cron pass authenticated` lines after ~2 minutes.
- `curl` the function with a wrong bearer → 401.

**Risk if wrong:** auth model broken → cron silently 401s. Catching
this before any source logic exists is the whole point of isolating
this chunk.

---

### Chunk 2 — Both sources + Expo Push client

**Files:**
- `supabase/functions/send-notifications/push.ts` — Expo Push Service
  client with full error-code routing (`DeviceNotRegistered`,
  `MessageRateExceeded`, `InvalidCredentials`, etc.).
- `supabase/functions/send-notifications/sources/reviews-digest.ts`
  — match SQL, per-user query, body composition (1 due / 2+ due
  variants), per-user error isolation.
- `supabase/functions/send-notifications/sources/in-progress.ts`
  — match SQL, eligibility check (mirrors `isInProgressVerse`),
  body composition.
- Update `index.ts` to dispatch to both sources sequentially.

**Why both sources together:** the source-pattern abstraction is
validated by having two consumers in the same chunk. Splitting would
mean Reviews calcifies the shape before we know it generalizes. The
in-progress SQL and body composition is small (~60 lines).

**What this proves:** with a manually-inserted `device_tokens` row
pointing at a real Expo push token (from Expo's online push tool),
a real push lands on a real device at the configured fire-time.

**Testing:**
- Insert a fake `notification_preferences` row for your user with
  `reviews_hour` = current minute + 2.
- Insert a fake `device_tokens` row with a token from
  https://expo.dev/notifications (web tool generates tokens for testing).
- Wait 2 minutes. Push should land. Check `notification_log` for `sent`.
- Toggle `reviews_enabled = false`, repeat — no push.
- Set fire-time to 5 minutes from now with no due verses — log shows
  `skipped-empty`.

**Risk if wrong:** SQL filters wrong → wrong users get pinged or
no users do. Body composition wrong → reviewers see broken copy.

---

### Chunk 3 — review.ts midnight-snap

**Files:**
- `lib/store/review.ts` — `nextDueAfterDays` rounds down to local
  midnight via `target.setHours(0, 0, 0, 0)`.
- Update the obsolete comment that explains the old hour-precise
  behavior.

**Why isolated:** it's a single load-bearing line in a shipped
subsystem (spaced repetition). Isolating means `git revert` is
surgical and review focus is tight.

**What this proves:** mastering at any time of day produces a
midnight-snapped `nextDueAt`. Existing review system unaffected.

**Testing:**
- Master a verse in-app, inspect Zustand state — `engraved.nextDueAt`
  is `T00:00:00.000Z` in local time.
- Walk through review-locked verses, in-app review view — still works.
- The order doesn't matter operationally (everything ships in the
  same App Store binary as Chunk 4); isolation is purely for review
  ergonomics.

**Risk if wrong:** spaced repetition regresses. Caught fast because
this chunk is small.

---

### Chunk 4 — Client notification module + dev menu + foreground wiring

**Files:**
- `package.json` — `expo-notifications` install.
- `app.json` — `expo-notifications` config plugin.
- `lib/notifications/index.ts` — public hooks.
- `lib/notifications/types.ts` — Preferences, payload types.
- `lib/notifications/api.ts` — Supabase wrappers (per CLAUDE.md
  invariant 1, all writes go here).
- `lib/notifications/preferences.ts` — Zustand slice + AsyncStorage cache.
- `lib/notifications/permissions.ts` — 4-state permission flow.
- `lib/notifications/tokens.ts` — token register + foreground refresh.
- `lib/notifications/deep-links.ts` — tap response handler routing.
- `lib/notifications/debug.ts` — `__DEV__` dev menu ("fire now,"
  "show pending," "reset prefs").
- `app/_layout.tsx` — wire foreground listener
  (`last_foregrounded_at` UPDATE, TZ check, token refresh,
  permission re-check) and tap response handler.

**Why dev menu lives here:** it's a debugging affordance you'll use
*while building this chunk*. Putting it in a later chunk means
you're flying blind through chunk 4 testing.

**Why foreground wiring lives here:** the in-progress source's
24h-active gate depends on `last_foregrounded_at`. If we wait until
chunk 6 to wire it, the gate is broken between chunks 4 and 6. Wire
it once in 4; everything downstream just works.

**What this proves:** signed-in test device → permission granted →
token registered → cron-fired push lands on a real device. First
real end-to-end milestone.

**Testing:**
- EAS native rebuild (this chunk requires native; subsequent JS
  changes can OTA).
- Sign in on a test device, grant permission, check `device_tokens`
  table has your row.
- Wait for the digest fire-time you configured in chunk 2 testing
  (or use the dev menu's "fire now").
- Push lands. Tapping it routes to Mastered.
- Verify TZ change handling: change device TZ in iOS Settings,
  foreground the app, check `notification_preferences.timezone`
  updated.

**Risk if wrong:** tokens don't register, or wrong, or stale → users
configure notifications and nothing arrives. The biggest chunk; expect
some iteration.

---

### Chunk 5 — Settings UI + Q1 explainer card + Q14 badge

**Files:**
- `app/(tabs)/settings.tsx` — notifications section: master toggle,
  per-source toggles, cadence picker, time picker.
- New component for Q1 explainer card mounted at root after sign-in
  (gated by AsyncStorage flag).
- Q14 "1" badge component on Settings tab icon.
- 4-state permission UI logic (undetermined / granted / provisional / denied)
  per the design doc table.

**What this proves:** real users can configure notifications
end-to-end. Install app → see explainer card → enable → configure
fire-time → receive at fire-time.

**Testing:**
- Fresh install (or clear AsyncStorage): explainer card appears
  after sign-in.
- "Maybe later" → card dismisses, Q14 badge appears on Settings tab.
- Visit Settings → badge clears.
- Toggle master OFF/ON, per-source toggles, cadence (daily/weekly),
  weekday picker (when weekly), time picker.
- Settings UI matches existing screen patterns (no new design tokens).
- 4 permission states render correctly (test by toggling iOS
  Settings → Notifications for the app).

**Risk if wrong:** UX is broken. Caught by you actually using it.

---

### Chunk 6 — Polish from device testing

**Files:** TBD — depends on what falls out of chunk-by-chunk testing.

**What lives here:**
- Bug fixes from device testing in chunks 1–5 that didn't fit cleanly
  into the original chunk (e.g., a copy tweak surfaced after
  end-to-end testing in chunk 5).
- The SQL parity comment on `lib/store/index.ts:1043` cross-referencing
  the in-progress SQL filter (per design doc).
- Documentation updates: graduate `notification-system.md` from
  `building` → `shipped`; extract durable decisions into the right
  Tier 2 doc (likely `docs/architecture/sync-and-storage.md` for the
  preferences sync model and a new `docs/architecture/notifications.md`
  for the broader system).

**Why this chunk exists:** every multi-chunk build leaves a tail of
small things. Better to plan one cleanup chunk than to amend earlier
commits or sneak fixes into unrelated chunks. Don't pre-plan the
contents — let device testing fill it.

---

## Build prerequisites (handle BEFORE chunk 1)

Per the design doc's "Build prerequisites" section:

1. **APN auth key.** `.p8` from Apple Developer uploaded via
   `eas credentials`. (Out-of-band; not in this branch.)
2. **Vault `cron_secret` bootstrapped.** Run via Supabase dashboard:
   ```sql
   SELECT vault.create_secret('<random-256-bit-hex>', 'cron_secret');
   ```
   Migration 017 has a `DO $$ ... $$` guard that fails the deploy
   loudly if this wasn't done.
3. **`expo-notifications` install.** Happens in chunk 4.
4. **`pg_net` extension.** Created by migration 017 itself.

## Decisions deferred to build phase

- Whether the dev menu ships in release builds gated by `__DEV__`,
  or stays TestFlight-only. (Design doc: "Open questions.")
- Settings UI styling specifics — match existing patterns; resolve
  case-by-case.

## Status tracker

| # | Chunk | Status | Commit |
|---|---|---|---|
| 1 | Backend infrastructure | shipped | (pending commit) |
| 2 | Both sources + push client | not started | — |
| 3 | review.ts midnight-snap | not started | — |
| 4 | Client + dev menu + foreground | not started | — |
| 5 | Settings UI + Q1 + Q14 | not started | — |
| 6 | Polish + doc graduation | not started | — |

Update this table as chunks land.
