# Feature: Notification System

> **Status:** `planning` *(stub — needs full planning round after
> review system ships)*
> **Author:** Caelan
> **Created:** 2026-04-27
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — that feature
> ships and bakes first. This stub captures fresh thinking before it
> evaporates; it is **not** ready to build.

## Why a stub

We split this from the review-system doc deliberately. The review
system is a data-model migration that touches every mastered verse
and changes the meaning of "engraved." Notifications are a leaf
feature that consumes review-system state. Different risk profiles,
different testing surfaces, different iOS/permissions concerns.

Plan order: ship review system → let it bake on prod for a few days
→ open a fresh planning round for this doc → resolve open questions
→ build.

## Problem

Once the review system ships, the app will know which verses are
due — but the user still has to open the app to find out. We need a
way to nudge them when a verse comes due so they actually return to
practice. Without a push layer, the review system is a quiet
in-app surface that motivated users will see and casual users will
miss.

## Solution shape (sketch — to be reworked)

iOS local notifications scheduled by the client when verses come
due. No APNs server, no Edge Function cron. The client recomputes
the next 7 days of due-counts whenever review state changes, and
schedules / cancels local notifications accordingly.

Three notification categories under consideration (Q5):
- **Daily review digest** — "N verses due for review today" at a
  fixed local time (e.g. 9am).
- **Per-verse ping** — fires the moment a specific verse becomes
  due. Likely too noisy.
- **Re-engagement** — fires after 3+ days of inactivity if any
  verses are due.

Permission asked the first time a verse is mastered (not at first
launch). If denied, surface a Settings banner that deep-links to
iOS Settings; never re-prompt programmatically.

Templated copy only — no LLM-generated text in v1.

## What this depends on (review system contract)

These are the points of contact this feature will consume. They are
locked into the review system on purpose:

- `progress.engraved.nextDueAt` is an ISO timestamp on every
  mastered verse, queryable client-side.
- `nextDueAt` is **midnight-aligned (local)** so "due today" is a
  whole-day concept, not an exact-minute one. This is what makes a
  daily digest tractable (recompute due count once per day, not
  per fire-time).
- The Library deep-link target route is
  `/(tabs)/(library)?reviewView=true`.
- Selectors `useDueCounts()` and `dueVersesFor(verses, now)` are
  available client-side without server calls.

If the review system changes any of these, this doc needs revisiting
before build.

## Open questions (to resolve in the next planning round)

These are *fresh-thinking* notes, not resolved decisions. They will
be re-examined alongside the actual production review-system data
once it's been live for a bit.

### Permission timing
- Ask after first mastery (warm moment) vs first launch (cold but
  catches everyone) vs in-app explainer card before the system ask.

### Notification grouping
- Daily digest only (one per day, baked content per day)
- Per-verse pings (one per due moment)
- Both with toggles
- iOS local notifications can't recompute body at fire time, so a
  digest means scheduling N+ days ahead with day-specific bodies and
  re-scheduling whenever review state changes.

### Quiet hours / fire time
- Fixed (e.g. 9am)?
- User-configurable (sleep-respecting)?
- Two windows (morning + evening)?

### Re-engagement triggers
- After N days of inactivity AND ≥1 due verse?
- Independent of due verses ("come back to Bread")?

### Copy templates
- One template? Rotation of 3-5? Do we vary tone (gentle vs
  motivational)?
- Does the verse reference appear in the body? ("Psalm 23 is due
  for review.") That's specific and motivating but means we need
  to encode user verses in scheduled-notification payloads.

### iOS pending-notification cap (64)
- Daily digest scheduled 7 days out = 7 max → safe.
- Per-verse pings could blow past 64 for power users.

### Foreground behavior
- Show in-app banner via `expo-notifications` foreground handler?
- Or silent in-foreground (rely on the in-app badges)?

### Permission denial UX (Q11 from prior draft)
- Settings banner with deep-link to iOS Settings is the
  conventional answer.
- Need to test deep-link reliability across iOS versions.

### Settings toggle granularity
- Master on/off only?
- Per-category toggles (digest, re-engagement)?
- Per-verse opt-out (probably no — over-engineered)?

## Technical sketch (not committed)

To be filled out in the next planning round. Outline only:

- `lib/notifications/scheduler.ts` — scheduler API
  (`requestPermissionIfNeeded`, `scheduleReviewNotifications`,
  `cancelAll`, `rescheduleAfterStateChange`).
- `lib/notifications/categories.ts` — category enum + toggle list.
- Hook into `updateVerseProgress` to call
  `rescheduleAfterStateChange` after every state-changing review.
- New AsyncStorage keys: `notification_prefs` (toggles, permission
  state). `clear()` should exempt these device prefs.
- Settings UI in `app/(tabs)/settings.tsx` — toggles + permission
  banner + deep-link to iOS Settings.
- Notification response handler in `app/_layout.tsx` — route to
  `/(tabs)/(library)?reviewView=true`.

## Deployment sequencing implications

This feature is **client-only** (no Supabase migrations, no edge
functions). That means it does not face the client-vs-server skew
problem that the review system has — there is no server-side
component to roll out separately. It ships when the App Store
release ships. ✓

## What this feature explicitly will NOT add

- Server-side push (APNs).
- Cross-device notifications (a review on phone A doesn't
  automatically dismiss the notification on phone B — local-only
  schedule will fire on whatever device scheduled it).
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications (out of scope; no daily streak
  notification).
- Notifications for non-review concerns (new VOTM, new
  collection, etc.).

## Next step

When review system is `shipped` and has baked for ~1 week, run a
fresh planning round on this doc:

1. Read this stub.
2. Look at real production data — how many verses are coming due
   per user per day? Does a digest make sense, or are users
   accumulating too many?
3. Resolve open questions above.
4. Write the full Technical Approach + Build order sections.
5. Then build.
