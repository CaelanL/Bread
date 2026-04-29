# Feature: Notification System

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Reframed:** 2026-04-28 — widened from "review notifications" to a
> notification *platform* with multiple sources.
> **Updated:** 2026-04-28 (round 2) — folded in product answers, locked
> in digest-per-day approach, added Q11/Q12/Q13.
> **Updated:** 2026-04-28 (round 3) — Caelan answered most sub-questions.
> Per-verse-with-digest-fallback replaces digest-as-primary. Generic
> explainer card replaces warm-trigger-only. Several questions closed.
> **Updated:** 2026-04-29 (round 4) — Per-verse-always replaces digest
> fallback. Re-engagement becomes invisible. Sub-questions on card
> timing, dot UI, in-progress cadence resolved. Per-source fire times
> locked.
> **Updated:** 2026-04-29 (round 5) — Killed the 9am Reviews
> checkpoint (vestigial after digest removal). Reviews now fire at
> the verse's actual `nextDueAt`. *(Round 5 introduced an 8am–10pm
> awake-window clamp; round 5d removed it.)* Q4/Q6/Q11/Q15/Q16
> swept for consistency.
> **Updated:** 2026-04-29 (round 5b) — Caelan walked the user-story
> edge cases and caught two real design errors: (1) max-interval
> slider should only affect future SR computations (was wrongly
> described as triggering bulk re-schedule); (2) successful review
> doesn't "cancel" — it replaces with the next due-time
> notification. Both fixes converged on a simpler model: **one
> pending Reviews notification per mastered verse, no rolling
> window** (replaces the 7-day rolling window from earlier rounds).
> Also locked the off-toggle confirmation pattern (Q7.1 #8). Added
> Q17 (testing strategy: dev menu, time-shift env var, unit tests)
> and Q18 (extensibility contract: 6-step "add a source" recipe,
> hard rules enforced by types/lint).
> **Updated:** 2026-04-29 (round 5c) — Senior engineering review +
> verification against actual code/SDK surfaced four real
> findings: (1) legacy `nextDueAt: null` mastered verses needed
> explicit handling (Q11 updated); (2) Reviews source switches
> from `CalendarTriggerInput` to `DateTriggerInput` because we
> want absolute-instant precision, not wall-clock-following — Q16
> rewritten; (3) Re-engagement's "no other source queued" gate
> was broken (per-verse Reviews always queued = Re-engagement
> never fires) — replaced with "no app foreground in 14 days"
> only (Q13 updated); (4) cross-source purity leak removed as a
> consequence of (3) — sources are now genuinely pure (Q18
> updated). Also locked: concurrent reconcile gate spec
> (mutex + trailing coalesce), cap-aware reconcile ordering,
> 60-cap behavior for heavy users.
> **Updated:** 2026-04-29 (round 5d) — Killed the 8am–10pm awake
> window clamp. Caelan: "if we're gonna do that, we might as
> well just do digest. I do not care if they get buzzed at 2am.
> Most people use do not disturb." v1 is now the simplest
> possible model: notification fires at exactly `nextDueAt`,
> no shifts, no windows, no quiet hours. DND handles 2am cases
> system-side. Removes a class of edge cases (sub-second
> collision math, post-reconcile drift, legacy clamp behavior).
> Also: Q12 permission flow agent verification complete — added
> `provisional` as fourth UI state, loading state during prompt,
> cold-start status persistence, cancel-all on external revoke,
> install-after-uninstall pre-check, Q1+Q14 mutual exclusion
> guard, in-flight tap gate, error handling.
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — that feature
> ships and bakes first. Reviews are the first consumer of this
> system, but the system is being designed to host other consumers
> (in-progress nudges, insight-driven prompts) without re-architecture.

## Why this is a planning doc, not a build doc

This doc captures *fresh thinking* about the shape of a notifications
platform. We are deliberately not committing to an implementation
yet — the review system needs to bake on prod first, and several
open questions need product/UX answers before SQL or TypeScript
makes sense.

The goal of this round: agree on the *shape* (multi-source platform
vs review-only feature), surface the open questions, and let real
review-system production data inform the answers in the next round.

## Problem

Once the review system ships, the app knows when verses are due —
but the user has to open the app to find out. More broadly, **Bread
has no outbound nudge layer at all**. Every motivational signal is
in-app: badges, counts, streaks, the home tab. Casual users miss
all of it because they don't open the app.

A push layer fixes that, but if we build it as a one-off "review
reminder" feature it'll calcify into a thing we can't extend. The
next time we want to nudge a user about something — an in-progress
verse they've abandoned, a personalized "you're 6 minutes from
finishing this collection" prompt, a re-engagement after a quiet
week — we'd be re-plumbing iOS permissions, scheduling, settings UI,
and copy templates from scratch.

So the problem is two-layered:
- **Immediate**: review-due verses need to nudge the user.
- **Underneath**: we need a clean, extensible notification *system*
  that future agents and features can plug into without re-learning
  iOS quirks or duplicating settings UI.

## Solution shape (high level)

A **notification platform** in `lib/notifications/` with three layers:

1. **Sources** — small, pure modules that, given current app state,
   declare *what notifications they want scheduled*. Each source
   owns its own logic and copy templates. Examples (built or future):
   - `sources/review-due.ts` — one notification per verse, fired at
     the verse's `nextDueAt` instant
   - `sources/in-progress.ts` — weekly nudge (6pm) about
     in-progress verses
   - `sources/insight-prompt.ts` *(future)* — personalized "5 min
     gets you 1 verse" using `getAvgTimeToMaster()`
2. **Scheduler** — a single module that owns all calls to
   `expo-notifications`. It collects descriptors from enabled
   sources, applies a budget (iOS 64-pending cap), de-duplicates,
   and reconciles the OS state. Sources never call
   `expo-notifications` directly.
3. **Preferences** — AsyncStorage-backed user settings (master
   toggle, per-category toggles, fire time, quiet hours), exposed
   via a hook (`useNotificationPreferences()`). Settings UI lives
   in `app/(tabs)/settings.tsx`.

The first source built will be **review-due** (the original stub's
scope). The platform is designed so adding the second source is
"write a new file, register it" — not "refactor scheduler."

iOS local notifications only in v1 — no APNs, no edge function cron,
no server push.

## Requirements

### Must have

- [ ] iOS local notifications for review-due verses (the original
      stub's scope is preserved).
- [ ] A source-based architecture so adding a future source is
      additive (new file + registration), not invasive.
- [ ] Settings UI: master on/off, per-source toggles, fire time.
- [ ] Permission flow: ask at a "warm" moment (TBD — see Q1), graceful
      handling of denial with deep-link to iOS Settings, no
      programmatic re-prompt.
- [ ] Notification tap deep-links into the right in-app surface
      (review notification → library review view).
- [ ] Scheduler respects iOS 64-pending cap and doesn't crash if
      sources collectively want more.
- [ ] Reconciliation when state changes — finishing a review
      cancels/reschedules the relevant pending notifications.
- [ ] AsyncStorage prefs survive `clear()` (sign-out) like other
      device prefs.

### Nice to have

- [ ] In-progress nudge source (probably v2 — after platform bakes).
- [ ] Insight-driven copy ("you have 5 verses in progress, ~30 min").
- [ ] User-configurable quiet hours.
- [ ] Per-source frequency caps ("at most one re-engagement / week").
- [ ] Foreground notification handler (in-app banner vs silent).

### Explicitly out of scope (v1)

- Server-side push (APNs / FCM).
- Cross-device dismissal (review on phone A → cancel on phone B).
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- Android-specific behaviors beyond what `expo-notifications` does
  by default (we'll re-evaluate after v1 baking).

## Architectural decisions (firm enough to anchor the design, soft enough to revisit)

### Multi-source platform, not review-only feature

The biggest decision in this doc. Tradeoff:

- **Platform now**: ~25% more upfront work (designing the source
  interface, the scheduler arbitration). Pays back the first time
  a second source is added. Future agents reading this doc see "add
  a source" as the canonical answer to "how do I send a notification."
- **Review-only now, refactor later**: faster v1 ship. Real risk:
  the second feature inherits whatever shape v1 happened to take,
  and "platform" never actually emerges. We've seen this play out
  in similar leaf systems before.

**Going with platform.** The user's brainstorm is explicitly about
extensibility, and the source interface is small enough that the
upfront cost is real but bounded.

### Sources are pure functions of state, not subscribers

A source exports something like:

```ts
type NotificationDescriptor = {
  id: string;             // stable; e.g. "review-due:psalm-23:2026-05-01"
  title: string;
  body: string;
  category: NotificationCategory;
  deepLink?: string;
} & (
  | { fireAt: Date }                                // absolute instant — Reviews
  | {                                               // wall-clock — cadence sources
      fireOn: { year: number; month: number; day: number };
      fireAtTimeOfDay: { hour: number; minute: number };
    }
);

type NotificationSource = {
  id: string;
  enabled: (prefs: Preferences) => boolean;
  describe: (state: AppState, prefs: Preferences, now: Date)
    => NotificationDescriptor[];
};
```

The descriptor's fire-time has two shapes — see Q16. Reviews emit
absolute `fireAt` (exact `nextDueAt`); cadence sources emit
wall-clock components (iOS re-evaluates in the device's current
timezone). Scheduler picks the iOS trigger type accordingly.

The scheduler calls `source.describe(...)` whenever it reconciles.
Sources do not subscribe, do not schedule, do not call
`expo-notifications`. This is what keeps them testable in isolation
and easy for a future agent to add.

### Scheduler owns all reconciliation

One reconcile function: gather descriptors from enabled sources →
diff against OS pending list → cancel removed, schedule added,
update changed. Reconcile triggers are enumerated in Q7 below.

This centralizes the iOS quirks (64 cap, no body recompute at fire
time, async permission state) in one place.

## Open Questions

Tagged by audience. **Product/UX** questions need your judgment;
**engineering** questions are tradeoffs I can recommend but want you
to confirm before they harden into the design.

**Round-5 status (2026-04-29):** All main questions settled.
Doc is ready for the agent verification pass on Q12, then graduates
to `building` once review system bakes on prod.

> 📍 **Reading note:** Q15 and Q16 live below "What this feature will
> NOT add" for historical reasons (added after that section was
> written). Mentally treat them as part of the Q1–Q14 sequence.

- **Settled (locked):** Q1 (generic explainer card, after sign-in,
  one-time, state-managed), Q2 (master + 2 visible toggles —
  Reviews, In progress; Re-engagement invisible), Q3
  (most-recently-practiced verse, deep-link to in-progress
  collection), Q4 (Reviews fire at exact `nextDueAt`; In-progress
  and Re-engagement use fixed times — see Q15), Q5 (suppress in
  foreground), Q7 (foreground-only reconciliation), Q8 (deep-link
  to collections, never auto-start session), Q9 (verse references
  in copy), Q10 (no migrations), Q11 (**per-verse always, no digest;
  fire at exact `nextDueAt`, no clamp** — round-5d reframe), Q12 (state-aware
  master toggle — **agent verification complete round 5d, four
  states + edge cases locked**), Q13 (re-engagement:
  14d, last-resort, single-shot, **invisible plumbing**), Q14
  (Settings tab "1" badge for explainer dismissers, one-time
  discovery hint), Q15 (per-source fire times: In progress 6pm,
  Re-engagement 12pm; Reviews fires at due-instant — no fixed time;
  user config v1-if-cheap for In progress only), Q16 (date trigger
  for Reviews, calendar trigger for cadence sources, no clamp), Q17
  (testing: dev menu + time-shift + unit tests + real-device
  sanity), Q18 (extensibility: 6-step add-a-source contract,
  hard rules enforced).
- **No remaining open sub-questions.** Pending only:
  agent-verification of Q12 flow (Action Items).

---

### Q1: When do we ask for notification permission? *(product/UX — round 3 settled)*

**Round-3 answer: Generic in-app explainer card, shown to everyone
on app launch, state-managed so users can dismiss it permanently.**

Caelan's reasoning: targeted post-mastery prompts miss users who
never master anything (the cohort that arguably needs the nudge
most). Most apps ask up front; users expect that. Don't over-explain
the review system — keep the framing simple.

**Card behavior:**
- Shows on next app launch for any user who has not yet seen it.
- One-time per device — not a recurring nag.
- Two actions: **Enable** (triggers the iOS system permission
  prompt) and **Maybe later** / X (dismisses the card without
  triggering the prompt).
- Card state persisted via AsyncStorage key (e.g.
  `notif_explainer_dismissed`). Survives `clear()` on sign-out.

**Important iOS constraint:** the OS-level permission prompt can
only ever appear *once* per app install. We protect that one shot:
"Maybe later" / X must NOT trigger the iOS prompt. Only "Enable"
does. This way a user who dismisses the card today can later go to
Bread Settings, flip the master toggle, and *that* triggers the iOS
prompt fresh. The card and the Settings toggle share the same one
shot — whichever comes first burns it.

**Special case: install-after-uninstall.** iOS remembers prior
denials across uninstalls. A user who previously denied and
reinstalled lands at `permission === 'denied'` immediately —
calling `requestPermissionsAsync()` would silently no-op. Mitigate
by **pre-checking permission status before tapping Enable**:
- If `undetermined` → call `requestPermissionsAsync()` (normal
  path; iOS prompt fires).
- If `denied` → skip the request, route directly to
  `Linking.openSettings()` with copy: *"Notifications were turned
  off — open iOS Settings to re-enable."*
This pattern is implemented in Q12 and applies to both the card
"Enable" button and the Settings master toggle.

**Dismissal flag write timing:** write
`notif_explainer_dismissed = true` only on **terminal user
action** (Enable resolves either way, OR Maybe Later tapped) —
not on card mount. Otherwise sign-out mid-card leaves the flag
inconsistent.

**For users who dismiss the card and never visit Settings:**
Caelan suggested a small nudge above the Settings tab in the bottom
nav — a dot or badge that draws attention to the notification
center. **Promoting this to its own question (Q14)** because it
intersects with the bottom-nav UI and deserves a real design
decision rather than a sidebar.

**Card copy direction (not final):**
- Title: *"Stay on top of your verses"*
- Body: *"Get reminders when verses are ready for review or need
  practice."*
- Buttons: *Enable notifications* / *Maybe later*

User stories covered:
- *Ana installs Bread.* Sees card on first or second launch.
  Enables. Done.
- *Ben taps Maybe later.* Card never returns automatically. He can
  enable later via Settings (and Q14's nudge dot will help him find
  it).
- *Cam is an existing user, updates to the new client.* Sees card
  on next launch — same flow as a new user. The card doesn't
  distinguish.
- *Dani never masters a verse, dismisses the card.* Settings + Q14
  nudge remain the path.

Resolved sub-questions:
- ~~Warm trigger vs first-launch~~ → **First launch (or close to
  it), generic framing.**
- ~~"Maybe later" never re-shows~~ → **Confirmed: one-time, never
  re-shows.**

Resolved sub-questions (round 4):
- ~~Show card on first launch or after sign-in?~~ → **After
  sign-in completes.** User has a Bread account at that point;
  card has minimal context to lean on.

---

### Q2: Per-source toggles or master toggle only? *(product/UX — round 3, mostly settled)*

**Round-3 answer: Master + 3 per-source toggles, ship all three at
v1.** Caelan confirmed the general shape ("more robust but still
simple") and didn't push back on shipping all three sources at
once.

The three sources:
- **Reviews** — verses ready for SR review (mastered-and-due)
- **In progress** — verses sitting unfinished, nudge to come back
- **Re-engagement** — haven't opened the app in 14+ days

Settings UI shape (updated round 4):
```
Notifications
─────────────────────────
[●] Notifications        ← master toggle (state-aware per Q12)
    Reviews              ← per-source
    In progress          ← per-source
```

Re-engagement is **not** a visible toggle (round-4 decision — see
Q13). It runs invisibly whenever the master is on. Per-source
toggles disabled / greyed when master is off.

Resolved sub-questions:
- ~~Ship all 3 at once vs review-only first?~~ → **Ship all 3.**
  Validates the platform abstraction; the second and third sources
  are the real test of whether the source interface is right.
  (Re-engagement ships as invisible source — see Q13.)
- ~~Default state when permission granted?~~ → **Both visible
  toggles on by default.**

---

### Q3: What's the "in progress" nudge actually saying? *(product/UX — round 3 settled)*

**Round-3 answer: One notification per fire, names the
most-recently-practiced in-progress verse, deep-links to the
in-progress collection.**

Caelan's framing: the in-progress nudge is conceptually a single
notification about the in-progress *collection*, not per-verse. We
pick the most-recently-practiced verse as the "hook" because that's
the one the user will most likely remember and want to return to.
The notification gets them back into the collection list, where
they pick whatever to study.

**Copy direction (not final):**
- *"Psalm 23 is waiting — pick up where you left off."*

If the user has only one in-progress verse, same copy works. If
they have many, we still name only the most-recently-practiced one
— this notification is a hook into the collection, not an inventory.

**Tap target:** in-progress collection (`IN_PROGRESS_COLLECTION_ID`,
the existing virtual collection in `lib/store/index.ts:52`).

Resolved sub-questions:
- ~~Trigger condition~~ → After 3 days since last practice on any
  in-progress verse, where the lead verse must have been practiced
  at least once (`bestAccuracy != null`). Caelan didn't push back
  on the round-2 lean; locking it.
- ~~Frequency cap~~ → Once per 7 days max. Same — locking the
  round-2 lean.
- ~~Personalized-effort copy ("~6 min gets one to mastered")~~ →
  Deferred to v2. Caelan didn't pursue the personalized direction
  in round 3; ship plain copy first.

---

### Q4: Quiet hours / fire time configuration. *(round 5 reframed)*

**Round-5 answer: Per-source fire-time strategy diverges by source.**
The original "fixed 9am for everyone" answer was vestigial — see
Q11 (Reviews) and Q15 (In progress, Re-engagement) for the live
decisions.

- **Reviews** — fire at exactly the verse's `nextDueAt`. No
  clamp, no quiet hours, no fixed daily checkpoint. See Q11.
- **In progress** — fixed time, 6pm local. User-configurable in v1
  if cheap, otherwise v2. See Q15.
- **Re-engagement** — fixed time, 12pm local. Never user-configurable
  (invisible plumbing). See Q15.

For cadence sources: "6pm local" follows the device's current
timezone (iOS calendar trigger). For Reviews: absolute instant
(iOS date trigger). See Q16.

Quiet hours: not implemented in v1. Users with iOS Do Not Disturb
get the system-level quiet behavior; users without it accept the
honest precision. User-configurable quiet hours stay in the
"Nice to have" bucket if any user actually asks.

---

### Q5: Foreground behavior. *(product/UX — round 3 settled)*

**Round-3 answer: Suppress in foreground.** Caelan: "I don't really
care for notifications while in the app."

`expo-notifications` foreground handler returns `shouldShowBanner:
false`, `shouldShowList: false` when the app is in the foreground.
Notifications still get *delivered* (so they appear in the in-app
state once the user is back), they just don't pop a banner over
whatever the user is doing.

---

### Q6: iOS pending-notification cap (64) — how do we budget? *(round 5 final — one-at-a-time, no rolling window)*

**Round-5 final: each mastered verse owns exactly one pending
Reviews notification at any moment. No rolling window.**

The earlier rounds' "schedule a 7-day rolling window" model was
over-engineering. With per-verse fire-at-due-instant (Q11), each
verse already has one precise next due-time. Scheduling its
*next-after-that* would require predicting the user's review
behavior — pointless because the user reviewing the verse is
exactly what determines when its next notification should fire.

**The model:**
- Every mastered verse → one pending Reviews descriptor (its next
  due-instant).
- When the verse's notification fires (the user got pinged) OR the
  user reviews the verse → that descriptor is "spent." On the next
  reconcile, SR has computed a new `nextDueAt` and we schedule
  *one* new descriptor for that.
- Slider changes (max-interval) take effect on the *next* SR
  computation, not retroactively. Already-pending descriptors
  fire as scheduled.

**Pending math (much simpler now):**
- Reviews: 1 per mastered verse = **N pending** where N = mastered
  count.
- In-progress: 1 if eligible = **0–1 pending**.
- Re-engagement: 1 if quiet period reached = **0–1 pending**.

Total: **N + 2** pending in the worst case.

**Cap math:**
- Typical user (~30 mastered): 32 pending. Plenty of headroom.
- Heavy user (60+ mastered): bumps the iOS 64-cap.
- **Hard-cap at 60 Reviews descriptors** to leave 4-slot buffer.
  When over cap, prioritize earliest-due-first; later-due verses
  go un-notified until their turn comes up via reconcile after an
  earlier one fires.

This is dramatically simpler than the rolling-window model:
- No window-length tuning.
- No daily re-scheduling churn.
- Slider behavior matches user intuition ("change applies
  next time SR runs, not to already-pending").
- Re-scheduling happens only when verse state actually changes.

**Defensive cap:** keep the "log-and-drop if reconciliation
produces >100 descriptors" guard against a future buggy source.

**Cap-aware reconcile ordering (locked round 5c):**
Reconcile is non-atomic — `cancelScheduledNotificationAsync` and
`scheduleNotificationAsync` are separate iOS calls. If we're
near the cap and naively cancel-old-then-add-new, the temporary
in-flight count is fine. But if we add-new-then-cancel-old, we
could momentarily exceed the cap and iOS may reject the new
schedule.

Rule: **always cancel-before-schedule in reconcile.** If we're
removing N descriptors and adding M, do the N cancels first, then
the M adds. Only the cancellations can fail in a way that leaves
us with stale state (which the next reconcile self-heals); the
adds can fail loudly and we surface that in dev logs.

**Heavy-user behavior at the cap (locked round 5c):**
A user with 200 mastered verses has 60 Reviews descriptors queued
(the soonest-due 60). The other 140 verses don't have iOS
schedules — they exist in our internal model and get scheduled as
slots open up.

Practical consequence: as the user reviews verses, slots open
naturally. Verse #61 (next-earliest of the unscheduled) gets a
slot when verse #1 fires or is reviewed. So every verse
*eventually* gets a notification, but for very heavy users it's
a queue, not a parallel set.

**Edge case for heavy users who never open the app:** the 60
queued notifications fire on schedule, and then nothing more
fires until the user opens the app (which triggers a reconcile
that can schedule new descriptors as old ones are cleared). This
is acceptable — Re-engagement (Q13) catches the truly inactive
user at 14 days, regardless of how many Reviews never got
queued.

This is the right tradeoff *for v1*: the alternative (digest
fallback for the truncated tail) reintroduces all the digest
complexity we just removed in round 4.

**v1 scope (locked round 5c):** No user currently has 60+
mastered verses, so the cap won't bite anyone. Caelan: "60 cap
is completely fine, no one has that many atm." Revisit if/when
the userbase has heavy users (likely a v2 problem, not v1).
Digest fallback for the truncated tail is a known follow-up;
deferred until needed.

---

### Q7: How does the scheduler know when to "reconcile"? *(engineering — round 3 settled)*

**Plain-language: "reconcile" = update the queued list of future
notifications.** iOS holds the queue; we update it when something
changes.

Caelan's round-3 challenge: *"Is there anything to reconcile if they
haven't touched the app?"* Honest answer: **almost never.** The user
not opening the app means no state changes, no preference toggles,
nothing for us to recompute. The schedule we set last time still
correctly reflects the user's state.

Edge cases where the queue could go stale without user action:
- iOS clears the queue on rare occasions (OS update, app crash on
  launch, hitting iOS's global notification cap from other apps).

Not fixable without the app being foregrounded — we can't run
code while the app is closed reliably enough to matter. Self-heals
on next foreground.

**Round-5 answer (audited against actual store API):
Foreground-only reconciliation.** The app reconciles on these
specific triggers. See the diagram below for a visual map.

| # | Trigger | Source code | What changes | Reconcile mode |
|---|---|---|---|---|
| 1 | App foregrounds | `app/_layout.tsx` AppState listener | permission state re-checked; any drift between our model and iOS's pending list corrects itself | full |
| 2 | `updateVerseProgress` | `lib/store/index.ts:805` | verse's `nextDueAt` shifts; in-progress↔mastered transitions; engraved updates | full |
| 3 | `addVerse` | `lib/store/index.ts:570` | new in-progress verse; affects In-progress source | full |
| 4 | `deleteVerse` | `lib/store/index.ts:721` | verse soft-deleted from both Reviews and In-progress sources | full |
| 5 | `resetVerseProgress` | `lib/store/index.ts` | verse moves mastered → in-progress; both sources affected | full |
| 6 | `setReviewMaxIntervalDays` | `lib/store/index.ts:99` | every verse's `nextDueAt` upper bound shifts | full |
| 7 | Master toggle on/off | `lib/notifications/preferences.ts` setter | enables/disables ALL sources at once | full (or cancel-all) |
| 8 | Per-source toggle on/off | `lib/notifications/preferences.ts` setter | enables/disables one source | source-scoped |
| 9 | Fire-time picker change (In progress) | `lib/notifications/preferences.ts` setter | In-progress descriptor fire-times shift | source-scoped |
| 10 | `clear()` (sign-out) | `lib/store/index.ts:948` | **cancel ALL pending; do NOT re-schedule** | cancel-all |
| 11 | Sign-in completes | `lib/auth/context.tsx` | new user state loaded; rebuild from scratch | full |
| 12 | iOS permission state changes externally | detected via `getPermissionsAsync()` on next foreground (#1) | granted: re-schedule; revoked: cancel all | full or cancel-all |

**Reconcile modes:**
- **full** — read all enabled sources, diff descriptors against OS
  pending list, cancel removed, schedule added.
- **source-scoped** — same as full but only touches one source's
  descriptors (cheaper; fewer iOS calls).
- **cancel-all** — wipe iOS queue, no re-schedule. Used on sign-out
  and permission revoke.

**Triggers we deliberately don't handle:**
- Time passing while app is closed (each verse's pending
  notification fires when its time comes, regardless of app state).
- Day boundary crosses while app is open (next state-change or
  foreground will reconcile).
- iOS clearing the queue without our knowledge (OS updates, etc.) —
  self-heals on next foreground via mode "full."

No background tasks. Each verse's one pending notification fires
on schedule via iOS even with the app closed. After it fires, the
app needs to foreground for the next one to be scheduled — which
is fine, because firing the notification is what gets the user to
open the app.

**Implementation hook points:**
- `app/_layout.tsx` foreground listener → reconcile (full)
- `lib/store/index.ts` actions: `updateVerseProgress`, `addVerse`,
  `deleteVerse`, `resetVerseProgress`, `setReviewMaxIntervalDays`,
  `clear` — each calls reconcile (or `cancel-all` for `clear`)
- `lib/auth/context.tsx` sign-in completion → reconcile (full)
- `lib/notifications/preferences.ts` setters → reconcile
  (mode depends on which preference)

**Concurrent reconcile gate (locked round 5c):**

Multiple triggers can fire near-simultaneously (e.g.
`updateVerseProgress` + foreground within the same tick). Without
gating, two reconciles run in parallel, race on the iOS pending
list, and produce drift.

Spec:
- The scheduler maintains a single `reconcileInFlight` boolean.
- If a reconcile is requested while one is in-flight, set a
  `pending: true` flag and return immediately. Don't queue
  multiple — one trailing reconcile is enough (reconciles are
  idempotent w.r.t. the same final state).
- When the in-flight reconcile finishes, check `pending`. If true,
  clear it and run reconcile again with `mode: 'full'` (the most
  conservative mode, since we don't know which trigger came in
  during the in-flight run).
- If a `cancel-all` request comes in during an in-flight
  reconcile, abort the in-flight (best-effort) and run cancel-all
  immediately. This is the only mode that takes priority.

Pseudocode:

```ts
let inFlight = false;
let pendingFull = false;

async function reconcile(mode) {
  if (inFlight) {
    if (mode === 'cancel-all') {
      await cancelAllAndClearPending();
    } else {
      pendingFull = true;
    }
    return;
  }
  inFlight = true;
  try {
    await doReconcile(mode);
  } finally {
    inFlight = false;
    if (pendingFull) {
      pendingFull = false;
      reconcile('full');  // tail-call; intentional
    }
  }
}
```

This handles the common cases (rapid state changes coalesce into
one trailing reconcile) and the worst case (sign-out arrives
mid-reconcile and takes priority).

**Reconcile self-healing (locked round 5c):**

Each iOS API call (`schedule`, `cancel`) can fail individually.
A partial-failure reconcile leaves drift between our model and
iOS's pending list. Recovery: the next `mode: 'full'` reconcile
does a fresh diff against `getAllScheduledNotificationsAsync()`
and corrects the drift. No retry logic in the scheduler — drift
is bounded by "until the next reconcile," and reconciles happen
on every foreground.

The one case to handle explicitly: if `cancel-all` is the next
reconcile after a partial failure, it nukes the queue regardless
of internal state — which is exactly what we want for sign-out.
Self-heals trivially.

---

#### Q7.1: Walkthrough — what happens when the user does X?

The point of this walkthrough is to make sure we've thought about
every reasonable thing a user can do and what should happen to
their notification queue in response. Reads top-to-bottom; no
diagram needed.

**The basic actions a user can take in Bread that affect
notifications:**

1. **Add a verse** to a collection.
2. **Practice a verse** (any difficulty, any accuracy).
3. **Master a verse** (90% on Hard — special case of #2 with extra
   side effects).
4. **Review a verse** that was due (also a special case of #2 —
   re-mastery on Hard).
5. **Delete a verse** (soft-delete).
6. **Reset a verse's progress** (mastered → back to in-progress).
7. **Change the Reviews max-interval** in Settings.
8. **Toggle a notification setting** (master, per-source, fire-time).
9. **Sign out**, **sign in**, **switch accounts**.
10. **Open the app** (foreground).
11. **Travel** / change timezone.
12. **Toggle iOS-level notification permission** in iOS Settings.

For each one below: *what it means, what changes in the user's
notification queue, and the edge cases.*

---

**1. User adds a verse.**

The new verse is in-progress (not yet mastered). It joins the
In-progress source's eligibility — which means it could become the
"hook" verse for the next In-progress nudge. Also, having ≥1
in-progress verse means Re-engagement now has a "tap target"
(in-progress collection) if the user ever goes quiet.

What we do: reconcile. Both In-progress and Re-engagement may emit
new descriptors. Reviews source isn't affected (not yet mastered).

Edge case: if this is the user's *first* verse ever, before this
moment all three sources had nothing to schedule. Reconcile after
add is what wakes them up.

---

**2. User practices a verse (didn't master).**

`bestAccuracy` updates; `lastPracticedAt` updates;
`isInProgressVerse` is still true. The In-progress source's "lead
verse" (most-recently-practiced) might now be this one — meaning
the next In-progress nudge will name *this* verse. Also, the user
just opened and used the app, so the 24-hour In-progress
activity-skip applies — *if* an In-progress nudge was about to
fire in the next 24 hours, it skips.

What we do: reconcile. In-progress descriptor copy may change
(different lead verse). The 24-hour skip is enforced inside the
In-progress source's `describe()` — no special trigger needed, the
reconcile just sees that "user practiced <24h ago" and emits 0
descriptors for In-progress this cycle.

Edge case: practicing a verse mid-session does NOT reconcile —
only end-of-session (`updateVerseProgress`) does. If a user is in a
30-minute session and an In-progress notification was scheduled to
fire mid-session, Q5 (foreground suppression) hides it. The
notification is still technically "delivered" — appears in the
notification shade once they background. Acceptable.

Edge case Caelan flagged: *what if an In-progress nudge fires,
the user ignores it, and then never opens the app again?* Answer:
because the In-progress source describes "every 7 days while
eligible" (Q15), the next reconcile (which happens whenever the
app foregrounds OR after any state change) will schedule the next
nudge 7 days out. If the user *never* opens the app, the schedule
we set when the previous nudge fired is whatever was queued at
that time — and per the one-at-a-time model (Q6), only one
In-progress nudge is queued at a time. So if they ignore the
nudge and stay closed, they don't get another In-progress one
until they open the app. **But Re-engagement (Q13) catches them
at 14 days inactive** — that's the safety net. So the cascade is:
weekly In-progress nudges while engaged, then Re-engagement at
14d if they go silent. Covered.

---

**3. User masters a verse.**

This is a state change: in-progress → mastered. SR computes
`nextDueAt` (e.g. 24 hours from now). Now this verse is in the
Reviews source's eligibility, *not* the In-progress source's
eligibility.

What we do: reconcile. Reviews source emits a new descriptor for
this verse's `nextDueAt`. In-progress source removes its
descriptor (this verse no longer in-progress). If this was the
*only* in-progress verse, the In-progress source might emit zero
descriptors entirely.

Master at 9am Tuesday → ping at 9am Wednesday. Master at 11pm
Tuesday → ping at 11pm Wednesday. Master at 2am Tuesday → ping
at 2am Wednesday. Whatever absolute moment SR computed, that's
when the notification fires. Users with iOS Do Not Disturb set
won't get woken up at 2am — DND silently delivers the
notification to the shade for them to see in the morning.

---

**4. User reviews a verse that was due.**

SR computes a new `nextDueAt` further in the future (longer
interval). We reconcile. The verse's previously-pending Reviews
notification (the one that fired or was about to fire) is now
"spent" — we schedule the *next* one for the new `nextDueAt`. So
the user gets pinged → reviews → next ping in ~14 days (or
whatever the new interval is). `passCount` may hit the engraved
milestone (10) but that doesn't change notification behavior —
engraved verses still get review notifications.

In the one-at-a-time model: each verse always has at most one
pending Reviews notification. After a successful review, that
slot gets the new descriptor.

Edge case: the user might have just received the notification for
this verse, opened the app, reviewed it, and continued. The next
notification for this verse is now ~14 days out. Smooth — no
duplicate, no missed transition.

Edge case (notification fires while user is already in the app):
Caelan flagged this. Sequence: user is mid-session at 9:00am, the
Reviews notification for Psalm 23 fires. Q5 (foreground
suppression) means iOS *delivers* it to the OS notification shade
but doesn't pop a banner over the app. The user sees nothing at
the moment.

If the user then reviews Psalm 23 *during* that session, SR
schedules the next notification for ~14 days out (correct). But
the previously-fired notification is still sitting in their iOS
notification shade — they could later swipe down, see it, tap it,
land on the library review view, and find Psalm 23 isn't due
(it's 14 days out now). Mild dead-end UX, not a bug.

Resolution options:
- **A (current default):** do nothing. The user sees a stale
  shade entry. If they tap it, library opens normally and shows
  what's actually due (which doesn't include Psalm 23). No-op.
- **B:** call `dismissNotificationAsync(id)` from the reconcile
  after `updateVerseProgress` to remove already-delivered
  notifications for verses we just re-scheduled. Cleaner shade.

**Locked: A for v1.** B is a small improvement we can add later if
production feedback surfaces confusion. The mild dead-end is
better than the engineering cost of tracking which delivered
notifications are now stale.

---

**5. User deletes a verse.**

Soft delete. The verse is gone from both Reviews and In-progress
source eligibility.

What we do: reconcile. Whichever source had a descriptor for this
verse drops it. iOS pending notification gets cancelled.

Edge case: if the deleted verse was the *only* in-progress verse,
the In-progress source's eligibility goes to zero — no nudge until
the user adds another verse.

Edge case: if the deleted verse was mastered AND a Reviews
notification for it was already delivered (in the user's shade,
not yet tapped), our reconcile cancels the *pending* one but
doesn't remove the already-delivered one. The user could tap a
notification for a verse they just deleted, land on the library,
and not see it. iOS limitation; acceptable.

---

**6. User resets a verse's progress.**

Mastered → in-progress. Mirrors #3 in reverse: this verse leaves
Reviews eligibility, joins In-progress eligibility.

What we do: reconcile. Reviews drops a descriptor; In-progress may
add one (if this verse becomes the new "lead" most-recently-
practiced).

Edge case: if a user resets all their mastered verses, the Reviews
source goes silent. Re-engagement is still active as the safety
net.

---

**7. User changes the Reviews max-interval (e.g. 30d → 90d).**

The slider only affects **future** SR computations — it caps
`daysFromNow` the next time SR runs (i.e. the next time the user
reviews a verse). It does NOT retroactively change
already-pending `nextDueAt` values.

What we do: nothing immediate. Already-pending Reviews
notifications stay scheduled as-is. The next time the user
reviews any verse, SR will use the new max — and that verse's
*next* notification is scheduled at the newly-capped interval.

Caelan flagged this explicitly: "I'm pretty sure changing the
slider only affects future iterations." Confirmed correct in this
design. The one-at-a-time model (Q6) makes this clean — there's
no rolling window to invalidate, no batch re-schedule.

This means a user dropping their max from 90d → 14d won't see
existing 90-day-out notifications shift to 14d. They'll see new
notifications respect 14d going forward. Acceptable — and matches
the user's mental model.

---

**8. User toggles a notification setting.**

Caelan in round 5 flagged that turning notifications OFF is
destructive (cancels everything; user might miss reviews) — so
the *off* path should have a confirmation step. Turning ON is
fine without confirmation.

**UX pattern (locked):**
- Master toggle OFF → confirmation modal: *"Turn off all
  notifications? You won't get review reminders or other nudges
  until you turn them back on."* [Cancel] [Turn off]
- Per-source toggle OFF → confirmation modal: *"Turn off
  [Reviews / In progress] notifications?"* [Cancel] [Turn off]
- Any toggle ON → no confirmation. Just toggle.

**Toggle visual state during the modal (locked round 5c):**
**Pessimistic** — the toggle stays in its previous (on) position
until the user confirms. Tap the toggle → modal appears with
toggle still showing as on → user taps Confirm → toggle animates
to off + reconcile cancels descriptors → user taps Cancel → modal
dismisses + toggle stays on (no flicker, no state change).

Why pessimistic vs. optimistic: turning off is destructive, and
optimistic flips can disorient users who tap Cancel ("did it
toggle? did I undo it?"). Pessimistic matches iOS Settings
patterns (e.g., "Delete Account" doesn't flip the toggle until
confirmed).

The Settings notifications section is its own page (not a single
toggle inline) so the confirmation modals have somewhere natural
to live.

Several flavors:

- **Master OFF** → cancel everything immediately. iOS queue empty.
- **Master ON** → re-build everything from scratch. iOS queue
  populates from current state.
- **Per-source toggle (Reviews / In-progress) OFF** → cancel only
  that source's descriptors. Other sources untouched.
- **Per-source toggle ON** → re-add that source's descriptors.
- **Fire-time picker** (In-progress only, if v1) → cancel + re-add
  In-progress descriptors with new times.

What we do: reconcile, with the appropriate scope.

Edge case: master OFF with Re-engagement already queued — yes,
cancelled too. Master is the kill-switch for everything including
the invisible source.

Edge case: master OFF then ON within seconds (user accidentally
toggled). Without the concurrent-reconcile gate this could
double-reconcile. Gate handles it.

---

**9. User signs out / signs in / switches accounts.**

Sign-out:
- We MUST cancel all pending notifications. Otherwise user B
  signing in on the same device gets user A's notifications.
- Notification *preferences* persist (AsyncStorage survives
  `clear()`). When user B signs in, their data loads but the
  preferences are user A's last state. **This is a real edge case
  — see #20 below.**

Sign-in:
- Reconcile from scratch. The signed-in user's verses and progress
  are now loaded; we describe and schedule.

Edge case (account switch on shared device): user A had Reviews
ON. User B signs in — Reviews is still ON. User B might get
notifications they never opted into. **Open question — see
follow-up below.**

---

**10. User opens the app (foreground).**

The catch-all. On every foreground:
- Re-check iOS permission state. If revoked externally, cancel
  everything. If newly granted, schedule everything.
- Reconcile (full). Any drift between our model of what's pending
  and iOS's actual queue corrects itself.
- `lastForegroundedAt` updates → matters for Re-engagement's
  14-day rule.
- If the user is signing in for the first time on this device,
  sign-in completion is part of this flow — not a separate event.
  Reconcile happens once, after auth resolves.

Edge case: user foregrounds the app while a notification was
showing on their lock screen. Tapping the notification deep-links
(Q8); just opening the app via the icon does nothing special with
the notification. iOS handles the lock-screen state.

---

**11. User travels / changes timezone.**

iOS calendar triggers automatically re-evaluate in the new
timezone (Q16) — most things keep working. The descriptor we
scheduled with `{ hour: 6, minute: 0 }` for In-progress fires at
6pm in the new local timezone, not the old.

What we do: nothing for Reviews — they use absolute date triggers
(Q16). The notification fires at the SR-computed UTC instant
regardless of timezone. The wall-clock display shifts (a verse
due "9pm PST" becomes "12am EDT" after travel), but the buzz
moment is the same instant in the world.

For cadence sources (In-progress 6pm, Re-engagement 12pm), iOS
calendar triggers automatically follow the user's new local
time. 6pm in NY = 6pm in NY. No code we run.

Edge case: cadence descriptor scheduled for "today 6pm local"
before the flight LAX→JFK is now scheduled for "today 6pm EDT,"
which might already be in the past. Foreground reconcile catches
this and rolls forward to tomorrow's 6pm.

Edge case: user turns on airplane mode for a long-haul flight. No
foreground events while flying. Already-scheduled notifications
fire normally on the new local timezone when iOS sees the device
clock change.

---

**12. User toggles iOS-level permission in iOS Settings.**

We only learn this on the next foreground (Q12). Detection happens
via `getPermissionsAsync()`.

- Was granted → now denied: cancel everything.
- Was denied → now granted: reconcile from scratch.

Edge case: user denies permission, app retains scheduled state in
its own memory. Re-granting later doesn't restore "what was
scheduled before" — it builds fresh from current state. Almost
always identical, but if state changed during the denied period,
the new schedule reflects current state, not the past.

---

**Things I noticed while writing this that we may not have
considered:**

13. **Mid-session notification.** If a user is mid-recording at
    6pm and an In-progress nudge was scheduled for then, does the
    foreground-suppression (Q5) still apply? Yes — the app is
    foregrounded during a session. Verified.

14. **Notification fires while the app is being launched** (cold
    start, splash screen). iOS treats this as foreground. Same
    answer: suppressed.

15. **Multiple devices, same account.** A user with the app on iPad
    + iPhone gets notifications scheduled on each device
    independently. If they review a verse on the phone, the iPad's
    notification for that verse is NOT cancelled — the iPad has
    no idea. Out of scope for v1 (cross-device dismissal is
    explicitly out, see "Will NOT add"), but worth flagging — a
    user with both devices will get duplicate-feeling pings.

16. **First-time user with zero verses.** Adds the explainer card
    is shown (Q1) → enables → grants permission → has zero verses
    → all sources emit zero descriptors → empty queue. The user is
    silently opted in but receives nothing until they add a verse.
    Correct behavior, just confirming.

17. **The user signs in but has never opened the app on this
    device before.** `lastForegroundedAt` doesn't exist yet — what
    does Re-engagement's 14-day rule compare against? Need a
    sensible default (probably "set to now on first sign-in") so
    Re-engagement doesn't fire on day 1.

18. **Concurrent triggers.** Two triggers near-simultaneously
    (e.g. user finishes a session AND backgrounds the app within
    the same second → `updateVerseProgress` reconcile + foreground
    listener cleanup). Naive implementation races. **Need a
    debounce/mutex** so only one reconcile is in flight; queued
    triggers collapse to one. Build note.

19. **Reconcile mid-failure.** iOS `cancelScheduled...` and
    `scheduleNotification...` are async. Network blip or platform
    error mid-reconcile leaves the queue in a half-cancelled,
    half-scheduled state. Recovery: the next full reconcile self-
    heals (it does a clean diff). No retry logic needed — but
    *only if* the next reconcile actually runs. Worth confirming.

20. **Account switch preference leak.** Sign-out clears verse
    state but notification preferences persist via AsyncStorage.
    User B inherits user A's master-toggle / per-source / fire-time
    preferences. **Locked round 5b: device-level.** Matches
    `colorMode` and `bibleVersion`. Tradeoff: a shared family
    device propagates one user's notification preferences to
    others. Acceptable — Bread is primarily a personal device
    app, and the alternative (account-level) means each sign-in
    starts fresh and might miss enabling notifications.

21. ~~Awake-window edge case (round 5).~~ **Obsolete** —
    round 5d removed the awake window. Reviews fire at exactly
    `nextDueAt`, no time-of-day filtering.

22. **Bible version change.** `setBibleVersion` doesn't reconcile
    today. Copy is reference-only (Q9), so this is fine — but if
    we ever add verse text to body copy, it becomes a missing
    trigger. Build note.

---

**Summary of things needing a decision before build:**

- **#17** — Default `lastForegroundedAt` for first-time sign-in.
  *Locked: set to "now" on first sign-in so Re-engagement doesn't
  fire on day 1.*
- **#18** — Concurrent reconcile gate (debounce/mutex). *Caelan:
  trust intuition; will gate during build.*
- **#19** — Confirm self-healing reconcile in build, no retry.
  *Caelan: trust intuition; will verify during build.*
- **#20** — Sign-out preference behavior. *Locked round 5b:
  device-level (matches `colorMode` and `bibleVersion`).*
- **#22** — Add `setBibleVersion` reconcile if/when copy ever
  includes verse text. *Build note only; no action now.*

Everything else is either already handled by existing design or is
acceptable as-is.

---

### Q8: Where does the notification deep-link land? *(product/UX — round 3 settled)*

**Round-3 answer: Always deep-link to a collection.** Caelan: "we
should deep-link and land people into collections pretty much for
everything."

Per-source landing:
- **Reviews** → library, filtered to review view (existing route
  `/(tabs)/(library)?reviewView=true`)
- **In progress** → in-progress collection (`IN_PROGRESS_COLLECTION_ID`)
- **Re-engagement** → in-progress collection if any verses are
  in-progress, otherwise mastered collection if any are mastered,
  otherwise home tab. (Re-engagement notifications only fire when
  no other source is firing — see Q13 — so the user has *something*
  but hasn't been engaging with it.)

Never auto-start a recording session from a tap. The user picks a
verse from the collection list. This is consistent across sources
and avoids surprises (microphone activating mid-meeting, etc.).

---

### Q9: Verse text in notification payloads — privacy. *(product/UX — round 2 settled)*

Round-2 answer: **Always include the reference.** Caelan: "I don't
care about people seeing what verses memorizing — no privacy
concern in my head, it's just a Bible verse."

Locked. Both review and in-progress sources will include verse
references in body copy.

(Note: we will *not* include verse *text* — only the reference
like "Psalm 23". The text-vs-reference distinction matters because
verse text could be longer, affect notification truncation, and is
a derived value we'd have to look up. Reference-only is simpler.)

---

### Q10: Migration concerns — none, but call it out. *(engineering)*

This feature is **client-only** (no Supabase migrations, no edge
functions, no schema changes). It does not face the
client-vs-server skew problem from CLAUDE.md invariant 11. Nothing
to coordinate with backend. It ships when the App Store release
ships. ✓

The only "deployment" concern is `expo-notifications` requires a
native rebuild (it's not in the JS bundle), so this can't ship via
Expo updates — it needs a new binary.

---

### Q11: Per-verse vs digest. *(round 5d final — per-verse, fire exactly at `nextDueAt`)*

**Round-5d final: Per-verse always. No digest. No threshold. No
clamp. No quiet hours. Each verse's notification fires at exactly
its `nextDueAt` instant.**

Round 4 settled "no digest." Round 5 killed the 9am checkpoint.
Round 5d kills the 8am–10pm clamp. The reason: Caelan: *"if we're
gonna do that, we might as well just do digest. Let's build a
very simple system for notifications at the moment, and maybe
adding stuff later. I do not care if they get buzzed at 2 a.m.
Most people use do not disturb."* The clamp added a class of
edge cases (legacy null-due users, post-reconcile drift, sub-second
collision math, same-day clusters at 8am) for a marginal benefit.
v1 is the simplest possible model: SR computed `nextDueAt`, we
schedule a notification for that exact moment, done.

**Why no clamp is OK:**

1. **Do Not Disturb does the work iOS-side.** Anyone who doesn't
   want 2am pings has DND set up — that's a system-level
   preference Apple already handles. We don't need to second-guess
   it.

2. **2am pings are rare.** Most users finish sessions during the
   day. A 2am `nextDueAt` requires a session ending at 2am exactly
   N days ago. Edge case, not main case.

3. **The user sees the notification when they wake up either way.**
   iOS doesn't auto-clear unread notifications. A 2am ping shows
   in the morning shade just like an 8am ping would. The only
   difference is whether the buzz interrupts sleep — and DND
   handles that.

4. **Eliminates a class of bugs.** No clamp window means no
   "verse fires next year because year is pinned and current day
   is past," no "TZ jump retroactively makes a wall-clock past,"
   no "all the late-night verses cluster at 8am." Significantly
   simpler.

**The model (locked):**
- Mastered verse with `nextDueAt` set → schedule one
  `DateTriggerInput` at exactly that instant.
- Mastered verse with `nextDueAt: null` (legacy migrated) → no
  descriptor (in-app review view shows them anyway).
- That's it.

**Legacy `nextDueAt: null` handling:**
A mastered verse migrated from the pre-review-system client has
`progress.engraved.nextDueAt === null` until its first qualifying
review (`lib/storage/index.ts:27`, `lib/store/review.ts:118`).
`isDueForReview()` already treats these as "due now."

The Reviews source emits **no descriptor** for null-due verses.
The user sees them in the in-app review view on foreground;
after first review, `nextDueAt` is set and the next reconcile
schedules a notification.

**Same-second collisions:** if two verses have identical
`nextDueAt` to the second (rare), iOS schedules them as separate
notifications — they have unique notification IDs, so iOS doesn't
deduplicate. Both fire. The user sees a stack of 2. Acceptable;
no special handling needed.

**Same-day collision (review + in-progress):** still possible
(in-progress fires at its configured time per Q15). Different
sources, different conceptual prompts; both fire.

Resolved sub-questions:
- ~~Digest threshold?~~ → **No threshold. No digest.**
- ~~Clamp window for late-night verses?~~ → **No clamp. v1 fires
  at exactly `nextDueAt`. Users with DND don't get buzzed at 2am
  anyway; users without DND signed up for honest precision.**
- ~~Lock-screen preview when many due?~~ → **iOS stacks the shade;
  not our problem.**
- ~~Sub-second collisions?~~ → **Don't handle. Each notification
  has a unique ID; iOS won't deduplicate; both fire.**

**If digest becomes necessary later** (production data shows
spread-out per-verse pings feel noisy, or users with very high
mastered counts get too many distinct notifications): re-add a
batch mode then. The source interface emits 0+ descriptors per
reconcile — sources are leaf modules — so adding a digest is
purely additive within `sources/review-due.ts`:
- threshold rule + combined copy → return 1 descriptor at a chosen
  fire-time instead of N descriptors at exact due-instants
- scheduler, preferences, permission flow, deep-link handler all
  unchanged

**Triggers to revisit this decision:**
1. Production data shows users with high mastered counts (50+) are
   getting too many distinct notifications spread across the day.
2. User feedback that per-verse pings feel noisy rather than helpful.
3. Users complain about late-night pings (the case we deferred to
   DND) — would justify adding the clamp/quiet-hours back as a
   user setting.

None requires a re-architecture; all are "edit one source file."

---

### Q12: How does Settings behave under iOS permission states? *(round 5d — agent verification complete)*

**Round-5d final: state-aware master toggle pattern, expanded to
handle four permission states (not just three) and several edge
cases the original spec missed.** Agent audit (round 5c → 5d)
surfaced the gaps; locked answers below.

**The four permission states:**

1. **`undetermined`** (not yet asked) — master toggle is enabled.
   Flipping it on triggers the iOS system prompt.
2. **`granted`** — master toggle works normally (on/off).
   Per-source toggles are interactive.
3. **`provisional`** (iOS 12+ "quiet" delivery — notifications go
   to the shade with no banner/sound/lockscreen) — master toggle
   shows ON with a subtitle: *"Delivering quietly — tap to allow
   banners & sound."* Tapping the subtitle calls
   `requestPermissionsAsync({ ios: { allowAlert: true, allowSound:
   true, allowBadge: true } })` to graduate to full grant.
4. **`denied`** — master toggle is disabled, replaced visually with
   a button **"Enable in iOS Settings"** that deep-links via
   `Linking.openSettings()`. One-line explainer below:
   *"Notifications are turned off in iOS Settings."*

We don't request `provisional` ourselves anywhere, but if a future
SDK update or another module requests it, our UI should still
make sense. The fourth state is defensive.

(`ephemeral` — App Clips only — is not relevant for Bread; no
branch needed.)

**Per-source toggles** are greyed when master is off (any reason
— `undetermined`, off-by-user, `denied`).

**Toggle visual state during `requestPermissionsAsync()`:**
**Loading state, no optimistic flip.** The toggle stays in its
previous position with a spinner overlay while the iOS prompt is
up. On resolve:
- Granted → toggle animates to ON.
- Denied → toggle stays OFF and is replaced with the "Enable in
  iOS Settings" recovery button.
- Provisional → toggle animates to ON with the quiet-delivery
  subtitle.

Why no optimistic flip: turning the toggle ON optimistically and
then snapping it back when the user taps "Don't Allow" is jarring
and feels broken. Loading state is honest about what's happening.

**Toggle taps are gated by an in-flight ref.** A double-tap
shouldn't fire `requestPermissionsAsync` twice. While the request
is pending, subsequent taps are ignored (toggle visually
disabled).

**Cold-start permission state hydration:**
On first paint, `getPermissionsAsync()` is async and hasn't
resolved yet. To prevent flicker (UI shows "enable" then snaps
to "denied" 100ms later), we **persist the last-known permission
status to AsyncStorage** and paint optimistically with that. The
async `getPermissionsAsync()` resolves and updates if it differs.
For first-ever launch (no persisted state), paint a skeleton
until resolution.

**Detection of external permission changes:**
Re-check permission status on every app foreground via
`Notifications.getPermissionsAsync()`. Cheap; the call is local.

**`granted → denied` transition (user revoked via iOS Settings):**
On detection, **call `cancelAllScheduledNotificationsAsync()`** and
clear our internal pending-list state. iOS would silently drop
already-scheduled locals once permission is revoked, but our
scheduler's model would still believe they're queued — leading to
drift on the next reconcile.

**Install-after-uninstall path (user denied previously, reinstalled
fresh):**
iOS remembers prior denials. AsyncStorage was wiped on uninstall,
so the Q1 explainer card shows fresh — but tapping "Enable" calls
`requestPermissionsAsync()` which iOS silently no-ops (returns
`denied` without showing a prompt). User sees nothing happen.

Mitigation: **before calling `requestPermissionsAsync()`, check
current status.** If already `denied`, skip the request and route
directly to `Linking.openSettings()` with copy:
*"Notifications were turned off — open iOS Settings to re-enable."*

This applies to both the Q1 card "Enable" button and the master
toggle in Settings.

**Q1 card + Q14 badge mutual exclusion:**
The card and the Settings-tab badge can both be visible at once
under certain conditions (returning user with verses, fresh
device install). Double-nag, looks broken.

Locked: **suppress the Q14 badge whenever the Q1 card is mounted.**
Both derive from the same `notif_explainer_dismissed` AsyncStorage
flag, but the badge has an additional guard: `!q1CardCurrentlyMounted`.

**Q1 card dismissal flag write timing:**
Write `notif_explainer_dismissed = true` only on **terminal user
action** (Enable resolves either way, OR Maybe Later tapped) — not
on card mount. Otherwise a sign-out mid-card leaves the flag in
an inconsistent state.

**Error handling:**

- **`Linking.openSettings()` failure** (rare; possible on
  MDM-restricted devices or simulator): wrap in try/catch. On
  failure, show a toast: *"Couldn't open Settings. Open the iOS
  Settings app and find Bread under Notifications."*
- **`getPermissionsAsync()` rejects** (theoretical bridge error):
  catch and treat as `undetermined` (most permissive — keeps the
  toggle interactive). Log to dev console.

**User stories the pattern handles:**

- *Nia dismissed the card.* Goes to Settings, master is
  `undetermined`, flips on, iOS prompt fires, grants. Smooth.
- *Otis tapped Enable on the card, then Don't Allow on iOS.*
  Goes to Settings, sees "Enable in iOS Settings" button, taps,
  lands in iOS Settings → Bread → Notifications.
- *Pat granted, then revoked via iOS Settings.* Returns to Bread,
  app foregrounds, permission re-checked, Settings now shows the
  recovery state. Pending notifications cancelled.
- *Quinn updated to a Bread version that introduced provisional
  delivery (or a new SDK adds it).* Cold-start shows the toggle
  ON with the quiet-delivery subtitle. Tapping the subtitle
  graduates to full grant.
- *Reza reinstalled Bread after previously denying.* Q1 card
  shows; tapping Enable detects existing denial, skips
  `requestPermissionsAsync` (which iOS would no-op), routes to
  iOS Settings deep-link with explanatory copy.
- *Sam double-taps Enable.* In-flight ref ignores the second tap.
- *Tyra opens Bread on a returning device with Q1 dismissed.* Q14
  badge would show — but Q1 card never re-mounts (already
  dismissed), so the badge guard is satisfied. Badge shows.

**Sign-in / sign-out interaction with permission state:**
Permission is device-level (iOS owns it). Q1 dismissal flag is
also device-level (AsyncStorage). User B signing in inherits user
A's dismissal flag. Per the round-5b decision (preference leak
locked as device-level for personal-device default), this is
intentional: the new user lands in Settings → tab badge or
Settings → master toggle to enable.

Resolved sub-questions:
- ~~Confirm state-aware pattern?~~ → **Yes, expanded to four
  states.**
- ~~Detection mechanism?~~ → **Foreground re-check via
  `getPermissionsAsync()`.**
- ~~Provisional permission?~~ → **Fourth state: ON-with-subtitle,
  graduate via re-request.**
- ~~Toggle UI during prompt?~~ → **Loading state, no optimistic
  flip.**
- ~~Cold-start flicker?~~ → **Persist last-known status; paint
  optimistically; skeleton on first-ever launch.**
- ~~`granted → denied` cleanup?~~ → **Cancel all scheduled, clear
  internal queue model.**
- ~~Install-after-uninstall?~~ → **Pre-check status; if denied,
  route to iOS Settings instead of `requestPermissionsAsync`.**
- ~~Q1 + Q14 co-occur?~~ → **Badge guards on
  `!q1CardCurrentlyMounted`.**
- ~~Card dismissal timing?~~ → **Write flag only on terminal
  action.**
- ~~`Linking.openSettings()` failure?~~ → **Toast with manual
  instruction.**
- ~~`getPermissionsAsync()` failure?~~ → **Treat as
  `undetermined`.**
- ~~Concurrent permission requests?~~ → **In-flight ref gate;
  ignore re-taps.**

---

### Q13: Re-engagement source spec. *(product/UX — round 3 settled)*

**Round-3 answer: Option B (channel of last resort), 14-day
threshold, single-shot until rearmed.**

Caelan in round 3: *"Yeah, we can just do B like you said. Every 14
days is fine and doesn't refire until someone rearms — opens the
app and goes quiet again."*

**Visibility (locked, round 4):** Re-engagement is **invisible
plumbing** — no Settings toggle. Caelan in round 4: *"re engagement
won't be a setting to toggle, lowkey, maybe we just secretly allow
it if master toggle on."* Reasoning: re-engagement is the safety
net of last resort; exposing it as a toggle just gives users a way
to disable the safety net. It runs whenever the master toggle is
on. The Settings UI shows only Reviews and In progress as toggles.

**Trigger rule (locked round 5c — simplified):**
- User has been inactive (no app foreground) for 14+ days, AND
- Re-engagement source has not fired during this quiet period
  (single-shot per quiet period).

**Why we dropped "no other source has a notification queued":**
The original gate (round 3) made sense in a digest-era world
where Reviews fired at most once a day. With per-verse Reviews
(round 4–5), every user with ≥1 mastered verse always has Reviews
descriptors queued — so the gate effectively *never* triggered.
Re-engagement was silently broken for any user with mastered
verses.

The fix: drop the cross-source gate. Re-engagement fires after
14 days of inactivity, regardless of what else is queued. Yes,
this means a user could get a Reviews notification AND a
Re-engagement notification on the same day. That's fine — they're
conceptually different ("hey, this verse is due" vs. "hey, you've
been gone for two weeks") and the inactive user we're trying to
reach probably needs both pings to actually notice.

This also fixes the cross-source-purity leak (Q18): Re-engagement
no longer needs to peek at other sources' descriptors. It's a
genuine pure function of `(state, prefs, now)` — specifically
`now - lastForegroundedAt > 14d`.

**Rearm rule:** the source rearms when the user opens the app
again. Once they return to quiet for 14+ days, it can fire again.

**Copy direction (not final):**
- *"It's been a while. Come build your memorization habit."* (no
  in-progress verses, nothing due)
- We could add state-aware variants later, but per Caelan's
  preference for simple, ship one generic copy in v1.

**Tap target:** per Q8, in-progress collection if any verses are
in-progress, otherwise mastered collection if any are mastered,
otherwise home tab.

Resolved sub-questions:
- ~~Threshold?~~ → **14 days.**
- ~~Re-fire behavior?~~ → **Single-shot per quiet period; rearms
  when user opens app.**
- ~~Option B (last-resort channel)?~~ → **Round 5c: dropped the
  cross-source gate.** Was structurally broken with per-verse
  Reviews. Re-engagement fires purely on inactivity.

---

### Q14: Settings tab nudge dot for users who dismissed the explainer card. *(product/UX — new in round 3)*

Caelan in round 3: *"Another option could be a little nudge
notification thing above the settings bottom tab, so users are
prompted to go to settings and look at the notification center."*

This is the recovery path for users who dismiss the Q1 explainer
card and need to find their way back to enable notifications later.

**Proposed behavior:**
- Show a "1" badge on the Settings tab in the bottom nav when
  *all* of:
  - User has dismissed the Q1 explainer card.
  - **Q1 explainer card is NOT currently mounted.** (Round 5d
    guard — prevents card + badge double-nag.)
  - iOS permission status is `undetermined` OR `denied`.
  - User has at least 1 verse in their library (signal of
    engagement; no point nagging an empty user).
- Badge disappears once user visits Settings (whether they enable
  notifications or not — the goal was discovery).
- Badge does NOT reappear after that initial discovery, even if
  permission state stays "not asked." One-time discovery hint, not
  a perpetual nag.

User stories:
- *Tariq dismissed the explainer card. Adds a verse. Sees the dot
  on Settings tab next launch. Taps Settings, sees the
  Notifications section, decides not now. Dot is gone.*
- *Una dismissed the card, never adds a verse.* Dot doesn't show
  (low engagement; respect it).
- *Vera enabled in the explainer card.* Dot never shows
  (permission already granted).

Resolved sub-questions (round 4):
- ~~Dot behavior?~~ → **Appears once when conditions met,
  disappears on first Settings visit, never returns.**
- ~~Visual: dot vs "1" badge?~~ → **"1" badge.** Caelan picked the
  badge form; conventional and reads as "something to check."
- ~~Show dot if permission already granted?~~ → **No.** The badge
  exists only to prompt discovery of the opt-in. Once granted, we
  have what we wanted.

### Q16: Timezone handling. *(engineering — round 5 swept)*

iOS-only app, but users travel and DST happens.

**What "fire at wall-clock time T local" actually means on iOS:**

`expo-notifications` supports two relevant trigger types:

- **`DateTriggerInput`** — fire at an absolute `Date` (a specific UTC
  instant). If the user crosses timezones, the absolute instant
  doesn't move with them.
- **`CalendarTriggerInput`** — fire when wall-clock components match
  (e.g. `{ hour, minute, day, month, year }`). iOS evaluates the
  match in the device's *current* timezone. This is the
  timezone-aware option.

**Cases we need to handle correctly:**

1. **User flies LAX → JFK (UTC−8 → UTC−5).** Cadence sources
   (In progress 6pm, Re-engagement 12pm) keep firing at the new
   local time automatically with a calendar trigger. Reviews fire
   at the verse's `nextDueAt` (absolute UTC) — same world-moment
   regardless of where the device is. The wall-clock display
   shifts (a 9am PST due-instant becomes noon EDT) but the buzz
   instant is unchanged.

2. **DST spring-forward (2am skipped).** Cadence sources (12pm,
   6pm) are outside the skipped window. Reviews use absolute
   instants, unaffected.

3. **DST fall-back (1am happens twice).** Cadence sources outside
   the ambiguous hour. Reviews use absolute instants, unaffected.

4. **User sets phone timezone manually.** Same as travel — calendar
   trigger picks up the new timezone on next eval; Reviews unchanged.

5. **Re-engagement "14 days inactive" calculation.** The 14-day
   threshold is measured in absolute time (from `lastForegroundedAt`
   timestamp), not wall-clock days. Travel and DST don't perturb
   it. Don't compute it as "calendar days since last open" —
   that's locale-dependent and produces off-by-one bugs at
   timezone boundaries.

6. **Per-verse Reviews `nextDueAt` is absolute UTC.** Stored
   consistent with the rest of the app
   (`lib/store/review.ts:41-42`). Reviews source schedules a
   `DateTriggerInput` for that exact instant. Travel/timezone
   doesn't affect when iOS fires it — only how it displays in the
   shade.

**Round-5c final: Sources use *different* iOS trigger primitives
based on their semantics.**

- **Reviews → `DateTriggerInput`** (absolute `Date` instant). We
  already know the absolute UTC moment we want the notification
  to fire — it's `nextDueAt` directly. Date triggers fire at
  exactly that instant, regardless of timezone. If the user
  travels, the notification still fires at the same absolute
  moment — its wall-clock display in the new timezone will be
  different, but that matches user intent ("review 24h after I
  mastered it" = the same world-moment, not the same wall-clock
  time).
- **In-progress + Re-engagement → `CalendarTriggerInput`** with
  `{ hour, minute, repeats: false, year, month, day }`. These
  sources are "fire at 6pm local" and "fire at 12pm local" — they
  *should* follow the user's wall-clock when they travel. Calendar
  triggers do this automatically (iOS evaluates in device's
  current timezone).

**Why two trigger types instead of one:** Reviews care about
absolute time (24h after mastery). Cadence sources care about
wall-clock time (6pm = "evening when the user winds down"). They
are conceptually different, so they use different primitives.
Earlier rounds tried to use calendar triggers for everything;
that introduced a bug where TZ-jumps could retroactively make a
descriptor's "next match" land a year out.

**Implications for descriptor shape:** the descriptor carries
either a `fireAt: Date` (Reviews) OR `fireOn` + `fireAtTimeOfDay`
(cadence sources). Scheduler picks the trigger type based on
which is provided. Updated `NotificationDescriptor`:

```ts
type NotificationDescriptor = {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  deepLink?: string;
} & (
  | { fireAt: Date }                                // Reviews — absolute instant
  | {                                               // Cadence — wall-clock
      fireOn: { year: number; month: number; day: number };
      fireAtTimeOfDay: { hour: number; minute: number };
    }
);
```

**Fire-time-already-passed gotchas (per trigger type):**

- **Date trigger:** if `fireAt` is in the past, `expo-notifications`
  fires it immediately. We don't want that. Mitigation: scheduler
  drops descriptors whose `fireAt < now` — the user sees the verse
  in the in-app review view anyway.
- **Calendar trigger:** if `{year, month, day, hour, minute}` is
  in the past, iOS rolls to the next match — which, with year+
  month+day pinned, is **next year**. Mitigation: scheduler
  rolls forward to the next valid occurrence of the wall-clock
  time (e.g., tomorrow's 6pm) before scheduling.

**Why earlier rounds' "calendar-trigger-everything" approach was
abandoned:**
- Required recomputing every Reviews descriptor's wall-clock on
  every foreground (the wall-clock derived in PST is wrong for
  Tokyo).
- Cancel + re-schedule churn for many descriptors per foreground.
- More iOS API calls, more chances for partial-failure drift.
- Reviews don't *need* wall-clock semantics — they need
  absolute-instant semantics. Use the right primitive.

**Out of scope:**
- Manual timezone override in app settings (some apps offer "always
  use this timezone for reminders" — not us, v1).
- Notifying the user when their schedule has shifted due to travel.
  iOS shows the new times if they look in iOS Settings → Bread →
  Notifications, but we don't proactively surface it.

Resolved sub-questions:
- ~~Date trigger vs calendar trigger?~~ → **Both.** Date trigger
  for Reviews (absolute instant); calendar trigger for cadence
  sources (wall-clock).
- ~~Pre-compute UTC instants?~~ → **For Reviews: yes**
  (`nextDueAt` is already absolute UTC, used directly by date
  trigger). **For cadence: no** (wall-clock components, iOS
  evaluates).
- ~~Manual timezone override setting?~~ → **No, out of scope.**
- ~~How to handle fire-instant in the past?~~ → **Drop (date
  trigger) or roll-forward (calendar trigger).**

---

### Q17: Testing strategy. *(engineering — new in round 5b)*

Notifications are *delayed* events that depend on iOS's clock.
Without explicit tooling the iteration loop is "schedule something
for tomorrow, wait until tomorrow, see if it fired." That's not
livable. v1 needs both copy iteration and timing iteration to be
fast.

**What works on the simulator (~80% coverage):**
- Scheduling, cancelling, fire-on-time delivery.
- Permission flow (grant / deny / iOS Settings deep-link).
- Foreground vs. background suppression.
- Tap → deep-link routing.
- Settings UI (toggles, modals, state-aware master button).

**What requires a real device:**
- Lock-screen UX (simulator's lock screen is fake).
- Haptic / sound feel.
- Notification shade interactions (stack expand, swipe to dismiss).

**Build-time tooling (locked):**

1. **Dev menu (hidden behind a long-press on a Settings row in
   `__DEV__` builds):**
   - "Fire each source's notification *now*" — calls the source's
     `describe()`, picks the first descriptor, fires it
     immediately. Lets you see the actual rendered copy without
     waiting.
   - "Show pending iOS notifications" — calls
     `getAllScheduledNotificationsAsync()` and dumps the list with
     fire-times, IDs, body. Useful for debugging "wait, why isn't
     this firing?"
   - "Force reconcile" — calls `reconcile()` manually so you can
     verify state changes propagate.
   - "Reset notification state" — clears AsyncStorage prefs +
     cancels all iOS pending. Fresh-state for testing.

2. **`NOTIFICATION_DEBUG_OFFSET_MS` env var** — when set in
   `__DEV__`, the scheduler subtracts this offset from every
   fire-time. So a "fire at 8am tomorrow" descriptor actually
   fires 5 seconds from now. Works cleanly with Reviews
   (`DateTriggerInput`) since it just adjusts the absolute Date.
   For cadence sources (`CalendarTriggerInput`), dev mode
   overrides the trigger type to `DateTriggerInput(now + 5s)` so
   the offset works the same way. Production paths are untouched.

3. **Unit tests** for pure-function logic:
   - Each source's `describe()` — covers eligibility logic
     (e.g. "skip null-due verses for Reviews"), descriptor IDs.
   - Scheduler's diff logic — given current-pending and
     desired-pending, does it produce the right cancel + add list?
   - **Source registration** — the test imports
     `sources/index.ts` and asserts every registered source has a
     unique `id`, exports a valid `describe()`, etc. Catches
     accidentally-broken sources at compile time.

4. **One real-device sanity test before ship.** Master a verse,
   background app, wait for notification, tap, verify deep-link.
   Repeat for each source.

**Copy iteration loop:**

Copy lives in `lib/notifications/copy.ts` (see Q18). Edit a copy
string → save → Metro hot-reloads → trigger via dev menu → see
new copy in <2 seconds. This is the "play around with copy a lot"
loop Caelan asked for.

For the actual iteration *in production* — once we have real users
and want to A/B test copy variations — we'd add a feature-flag
shape to `copy.ts` that picks variant by user. Out of scope for v1
but trivial to retrofit because copy is already isolated.

Resolved sub-questions:
- ~~Can we test on simulator?~~ → **Yes, ~80% of behavior.**
- ~~How fast is the iteration loop?~~ → **<5 seconds with dev
  menu + time-shift.**
- ~~Real-device testing required?~~ → **Yes for lock-screen UX
  and haptics; sanity test before ship.**

---

### Q18: Extensibility contract — adding a new source. *(engineering — new in round 5b)*

The platform's whole point (round 1 reframe) is that adding source
N+1 should be "write a file, register it" rather than "refactor
the scheduler." Round 5b locks the contract explicitly so future
agents know what's load-bearing.

**To add a new notification source, the contract is exactly:**

1. Create `lib/notifications/sources/<name>.ts` exporting a
   `NotificationSource`:
   ```ts
   export const myNewSource: NotificationSource = {
     id: 'my-new-source',
     enabled: (prefs) => prefs.master && prefs.perSource.myNew,
     describe: (state, prefs, now) => [/* descriptors */],
   };
   ```
2. Register it in `lib/notifications/sources/index.ts` by adding
   to the exported array.
3. Extend `Preferences.perSource` in `lib/notifications/types.ts`
   with the new flag (defaults to `false` so the source is
   inert on existing installs until the user opts in).
4. Add copy entries to `lib/notifications/copy.ts` under a new
   namespace.
5. Add a Settings UI toggle (or skip if invisible plumbing like
   re-engagement).
6. Add deep-link route handling to `lib/notifications/deep-links.ts`
   — pass the source's `deepLink` field through the existing
   route + params handler.

**That's the entire surface.** No scheduler edits, no permission
edits, no reconcile-trigger edits, no iOS API touches.

**Hard rules (enforced via TypeScript and code review):**

- Sources MUST NOT call `expo-notifications` directly. Only the
  scheduler does.
- Sources MUST NOT subscribe to events (Zustand, AppState, iOS).
  They are pure functions of `(state, prefs, now)`.
- Sources MUST NOT know about other sources. *(Round 5c removed
  the previous documented exception for re-engagement — the
  cross-source gate was dropped. Sources are now genuinely pure.)*
- Sources MUST NOT define copy inline — all strings live in
  `copy.ts`.
- Source `id` MUST be unique and stable. Used as descriptor ID
  prefix. Renaming an `id` invalidates already-pending
  notifications.

**Soft conventions (recommended but not enforced):**

- Source files stay <100 lines. If your source is big, extract
  helpers — but put them in the source's own file or a sibling,
  not into `lib/notifications/` core.
- Copy uses functions that take parameters (`title(verseRef:
  string)`) rather than templated strings. Type-safety; easier
  refactors.
- Descriptor IDs use the format `<source-id>:<entity-id>:<date>`
  (e.g. `review-due:psalm-23:2026-05-01`) so they're parseable
  for debugging.

**Why this matters for future-you:**

The temptation when adding a 5th or 6th source is to short-circuit
something — "I just need to call iOS directly this once." Don't.
The whole point of the platform is that the scheduler owns iOS,
permission, retry, reconcile, the 64-cap, etc. A source that calls
iOS directly bypasses all of that and creates a class of bugs that
will only surface in production.

**Things explicitly designed for v2 sources (not v1, but
load-bearing in the contract):**

- **Variable copy / personalization.** Copy functions can take any
  state needed (`getAvgTimeToMaster()`, current time of day, etc.).
  No new infra needed when a future source wants personalized
  copy.
- **A/B testing copy.** `copy.ts` can grow a variant resolver
  (`copy.reviews.body(state, variant)`) without touching sources
  or scheduler.
- **Cross-source frequency caps.** "At most 3 notifications per
  day across all sources" — would live in the scheduler as a
  cross-cutting rule. Sources don't need to know.
- **Per-source quiet-hours overrides.** No source declares one in
  v1 (Reviews originally had a clamp; round 5d removed it). If a
  future source needs quiet-hours behavior, it can opt in via
  descriptor metadata without scheduler changes.

**The test that proves this works:**

A unit test that loads `sources/index.ts`, iterates over every
registered source, and asserts:
- Each `id` is unique.
- Each `enabled()` returns a boolean for arbitrary prefs.
- Each `describe()` returns an array of valid descriptors for
  arbitrary state.
- No source imports `expo-notifications` (lint rule).
- No source imports another source (lint rule).

This test catches future drift automatically — if someone
accidentally adds an `expo-notifications` import to a source, CI
fails before merge.

Resolved sub-questions:
- ~~How explicit do we make the contract?~~ → **Six steps
  documented above; hard rules enforced via types + lint; soft
  conventions documented.**
- ~~Should sources be runtime-pluggable?~~ → **No.** Static
  registration in `sources/index.ts`. Runtime pluggability
  trades simplicity for flexibility we don't need.
- ~~Cross-source coordination?~~ → **None.** (Round 5c.) The
  previous "documented exception" for Re-engagement was removed
  when we simplified its gate. Sources are pure leaves.
- ~~Copy management at scale?~~ → **`copy.ts` namespaced by
  source.** A/B variants can be added later without touching
  sources.

---

## Technical sketch (will become the full Technical Approach in next round)

Outline only — to be filled out once the open questions are
answered.

```
lib/notifications/
├── index.ts              # public API: hooks + register/unregister
├── types.ts              # NotificationDescriptor, NotificationSource, Preferences
├── scheduler.ts          # the single owner of expo-notifications
├── preferences.ts        # AsyncStorage-backed prefs + Zustand subscription
├── permissions.ts        # request flow, denial banner state
├── deep-links.ts         # response handler that routes taps
├── copy.ts               # all notification copy, namespaced by source
├── debug.ts              # __DEV__-only dev menu helpers (Q17)
└── sources/
    ├── index.ts          # registers all sources
    ├── reviews.ts        # v1 source — fires at exact nextDueAt
    ├── in-progress.ts    # v1 source — weekly cadence
    └── re-engagement.ts  # v1 source — invisible, 14d inactive
```

Hook surface (from `lib/notifications/index.ts`):

```ts
useNotificationPreferences()    // { enabled, perSource, fireTime, ... }
useNotificationPermission()     // { status, request, openSettings }
useNotificationSettingsBanner() // boolean (show banner if denied?)
```

Internal (called by store, not components):

```ts
reconcileNotifications()        // called after updateVerseProgress, prefs change, foreground
```

Source registration is static (an array in `sources/index.ts`) — not
runtime-pluggable. Adding a source = edit that file + add the source
file + add a toggle to Settings UI.

## Edge cases to think through (next round)

Status: most addressed in Q7's trigger table; remaining items below
are the ones that don't fit neatly into a reconciliation trigger
and deserve their own attention during build.

- ✅ ~~User denies, then enables in iOS Settings.~~ → Q7 covers
  via foreground permission re-check.
- ✅ ~~User signs out (`clear()`).~~ → Q7 covers: `clear()` cancels
  all pending notifications.
- ⚠️ **User changes Bible version mid-flight.** Affects copy if we
  ever include verse *text* in the body. Currently we only include
  references (Q9), so this is moot for v1. Flag it if scope expands.
- ⚠️ **iOS upgrades that reset notification permission.** Rare but
  happens. Foreground re-check (Q7) handles detection; UX is the
  state-aware master toggle (Q12) showing "Enable in iOS Settings."
- ⚠️ **Scheduled fire time has already passed by the time we
  schedule it.** Calendar triggers fire at the *next* match, which
  with year pinned means **next year**, not today. Resolution per
  source documented in Q16. Implementation detail for the
  scheduler — easy to get wrong.
- ⚠️ **Sub-second collision offsets** (Q11) must use a deterministic
  hash of the descriptor ID, not a fresh random per reconcile.
  Otherwise cancel/reschedule churn produces different fire-instants
  each time, which could create "notification jitter" or
  unintentionally double-fire if the cancel races the schedule.

## What this feature explicitly will NOT add

- Server-side push (APNs / FCM).
- Cross-device dismissal coordination.
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- Notifications on web (`expo-notifications` is mobile-only; web is
  a no-op).

### Q15: Per-source fire timing — should each source have its own time? *(round 5 reframed)*

This question originally framed *all three* sources as having a
fixed daily fire-time (Reviews 9am / In progress 6pm /
Re-engagement 12pm). Round 5 dropped the fixed-time model for
Reviews — Reviews fire at the verse's actual `nextDueAt`. (Round
5 also introduced an 8am–10pm awake clamp; round 5d removed it
— see Q11.) So this question now applies to In progress and
Re-engagement only.

**Why Reviews don't get a fixed time:** SR is precise — each verse
has a real `nextDueAt`. A fixed daily fire-time was a digest
holdover. Now killed.

**Why In progress and Re-engagement *do* get fixed times:** they
don't have an SR-derived due-instant. They're cadence-based ("nudge
weekly" / "nudge after 14 days"), so we have to pick *some*
moment. Fixed wall-clock times are the simplest answer.

**Round-5 final:**

Locked fire times:
- **Reviews**: exact `nextDueAt` (no fixed time, no clamp). See Q11.
- **In progress**: 6pm local *(default; user-configurable if config
  UI lands in v1, otherwise tunable constant)*
- **Re-engagement**: 12pm local *(not user-configurable — Caelan
  in round 4: "not user config actually for re-engagement, just
  progress reminder")*

Caelan's round-4 framing: *"if user config is easy, id say add
it, maybe not user config actually for re-engagement, just
progress reminder."* So a time picker for In progress *if* the
config UI is cheap to add. If it's not trivially cheap, ship
constants only and add config in v2. Reviews never gets a picker
(no fixed time to pick).

**Engineering note:** the descriptor's wall-clock components
(`fireOn` + `fireAtTimeOfDay`) come from different sources by
source-type:
- Reviews: derived from the verse's `nextDueAt` directly.
- In progress / Re-engagement: derived from a constants file (or
  AsyncStorage if config UI ships).

Adding the time-picker UI for In progress is a one-line change to
read from AsyncStorage instead.

Resolved sub-questions:
- ~~Per-source fixed times vs same time?~~ → **Per-source for the
  two cadence sources; Reviews has no fixed time at all (Q11).**
- ~~6pm / 12pm right defaults?~~ → **Yes — confirmed starting
  point. Tune in production.**
- ~~Hook for future user-configurable times?~~ → **Yes for In
  progress; never for Reviews or Re-engagement.**
- ~~User-configurable in v1 or v2?~~ → **v1 if cheap, otherwise v2.
  In progress only.**
- ~~Re-engagement user-configurable?~~ → **No — never. Re-engagement
  is invisible plumbing (Q13).**

**On in-progress trigger frequency (also surfaced in round 4):**

Caelan in round 4: *"As long as there's stuff in [in-progress], I
imagine it's worth nudging them about it… time of day when to
notify them about that, if it's a weekly thing or like a week and
a half type thing."*

This loosens the round-3 lock that in-progress fires "after 3 days
of inactivity + ≥1 in-progress verse + lead verse practiced once."
Caelan's round-4 framing is more relaxed: nudge on a regular cadence
as long as there's anything in-progress.

Re-opening Q3.1 / Q3.2:

**Trigger options (round 4 re-think):**

- **A — Round-3 lock:** 3 days inactive + ≥1 in-progress + lead
  verse practiced once. Once per 7 days.
- **B — Pure cadence:** every 7 days, fire if ≥1 in-progress verse
  exists (regardless of activity).
- **C — Cadence with activity-skip:** every 7 days, fire if ≥1
  in-progress verse exists AND the user hasn't opened the app in
  the last 24 hours. (Avoids nagging an active user.)
- **D — Cadence, longer:** every 10–14 days (Caelan's "week and a
  half" suggestion).

**Round-4 final: Option C, every 7 days.**

Caelan in round 4: *"good with that rule"* (confirms Option C),
*"lowkey 7"* (cadence). Weekly habit cadence; respects active users
via the 24-hour skip; drops the round-3 "lead verse practiced once"
gate.

**Trigger rule (locked):**
- ≥1 verse exists with `bestAccuracy != null` on any difficulty AND
  `progress.hard.completed === false` (the existing
  `isInProgressVerse` predicate, lib/store/index.ts).
- AND: 7+ days since the last in-progress notification fired.
- AND: User has not foregrounded the app in the last 24 hours.

Lead verse for the notification: most-recently-practiced
in-progress verse (per Q3, locked).

Resolved sub-questions:
- ~~Trigger rule (A/B/C/D)?~~ → **C. With 24h activity skip.**
- ~~Cadence (7/10/14 days)?~~ → **7 days.**
- ~~Drop "lead verse practiced once" gate from round 3?~~ →
  **Yes, dropped. Any in-progress verse counts.**
- ~~Should "activity skip" track in-progress activity specifically,
  or just app foreground?~~ → **App foreground.** (Round 5b
  re-walk.) Tracking per-collection or per-source activity adds
  state for marginal benefit. Caveat: a user who opens the app
  daily but never practices in-progress verses won't be nudged
  about them. Acceptable — they're engaged with mastered review,
  which is their choice.

---

## Action Items

These are tasks that need to happen *before* this doc graduates to
`building`. Some are agent dispatches, some are decisions still
needed from Caelan.

- [x] **Resolve open sub-questions in Q1, Q11, Q14, Q15.** ✅
      Closed in round 4 (2026-04-29).
- [x] ~~**Real-device test: same-second notification coalescing.**~~
      No longer relevant. Round 5 dropped the 9am batch entirely;
      Reviews fire at clamped `nextDueAt` so verses spread across
      the day naturally.
- [x] **Agent walks the Q12 permission-state flow exhaustively.**
      ✅ Round 5d. Surfaced 13 findings; integrated into Q12,
      Q1, and Q14. Highlights: added `provisional` as fourth
      state; loading state during `requestPermissionsAsync` (no
      optimistic flip); cold-start hydration via persisted last-
      known status; cancel-all on `granted → denied` external
      revoke; install-after-uninstall pre-check; Q1+Q14 mutual
      exclusion guard; in-flight request gate; error handling
      for `Linking.openSettings` and `getPermissionsAsync`.
- [x] **Diagram all scheduler-triggering actions.** ✅ Round 5 —
      see Q7.1 (visual map), Q7.2 (cross-source ripples), Q7.3
      (gap analysis). Surfaced 8 build-time considerations to
      verify.
- [ ] **Add `expo-notifications` config plugin.** SDK 54
      deprecated the `notification` field in `app.json`. Use the
      config plugin form: `["expo-notifications", { ... }]` in
      the `plugins` array. Small, easy to miss.
- [x] ~~**Wait for review system to bake on prod for ~1 week.**~~
      Skipped — Caelan: "I have like five users and none of them
      use the app." No real distribution to validate against. Cap
      math is fine for the actual scale; ship and tune later if
      it ever matters.
- [ ] **Promote doc to `building`** once the above are resolved.
      Fill in full Technical Approach (file-by-file) and Build
      order (PR-sized chunks) sections.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Original stub created, review-only scope. | Split from review-system doc to keep risk profiles separate. |
| 2026-04-28 | Reframed as multi-source platform. | User's brainstorm explicitly asked for extensibility (in-progress, insight-driven). Platform shape is bounded extra work; doing it later is harder than doing it now. |
| 2026-04-28 | v1 ships 3 sources: review-due, in-progress, re-engagement. | User confirmed appetite for "more robust but still simple." Three sources validate the platform abstraction better than shipping one. Scope decision; could still narrow at build time. |
| 2026-04-28 | Permission asked via in-app explainer card at warm moment, not first launch. | iOS doesn't allow notification preview before grant; explainer card is the conventional substitute. Warm = first mastery (new users) or first post-update open (existing users with mastered verses). |
| 2026-04-28 | ~~Fire time: fixed 9am local, no configuration in v1.~~ **Superseded round 5** — Reviews fire at clamped `nextDueAt`; In progress 6pm; Re-engagement 12pm. | User explicitly preferred simplest. Time picker can be added later if needed. |
| 2026-04-28 | Verse references included in notification body. | User: "no privacy concern in my head, it's just a Bible verse." References only, not full verse text. |
| 2026-04-28 | ~~Review source uses digest-per-day, not per-verse pings.~~ **Superseded round 4** — per-verse always, no digest. | Worst-case (e.g. 100 verses due same day) becomes 1 notification, not 100. Also collapses iOS 64-cap problem. |
| 2026-04-28 | Reconciliation is foreground-only, no background tasks. | iOS background tasks unreliable. Foreground reconciliation covers the user-engaged case; the never-opens-the-app case relies on the schedule we set last time, which is acceptable. |
| 2026-04-28 | Notification taps always land on a list, never auto-start a session. | Auto-starting a recording session from a tap is intrusive (microphone, context). One-tap difference for users who do want to practice. |
| 2026-04-28 | Round 3: Generic in-app explainer card on launch, replacing warm-trigger-only. | Caelan: warm-trigger misses users who never master. Generic up-front asks like most apps do; users expect it. |
| 2026-04-28 | Round 3: Card is one-time per device, state-managed via AsyncStorage. | Don't nag. Recovery path is Settings + Q14 nudge dot. |
| 2026-04-28 | Round 3: "Maybe later" / X must NOT trigger the iOS prompt. | iOS gives one shot at the system prompt. Card and Settings toggle share the same shot — whichever is first burns it. |
| 2026-04-28 | Round 3: Per-verse review notifications by default; digest only when ≥3 due same day. | Caelan pushed back on digest-as-primary. Per-verse is warmer for the average user. Digest fallback prevents nuclear case (8+ buzzes). Threshold of 3 is tunable. |
| 2026-04-28 | Round 3: Re-engagement = Option B, 14-day threshold, single-shot per quiet period. | "Channel of last resort" — fires only when no other source is queued. Rearms on app open. |
| 2026-04-28 | Round 3: Q14 added — Settings tab nudge dot for users who dismissed the explainer card. | Discovery path for users who skip the card; respects user signal (no dot if no verses added). |
| 2026-04-28 | Round 3: Suppress notifications in foreground. | Caelan: "I don't really care for notifications while in the app." |
| 2026-04-28 | Round 3: Pre-build action — agent verifies Q12 permission-state flow exhaustively. | Caelan: "you can set an agent to double check the question 12 flow." |
| 2026-04-29 | Round 4: Per-verse always, no digest, no threshold. | Caelan pushed back on digest as primary. Investigation surfaced that iOS coalesces same-second same-app notifications to one buzz, so the buzz-cluster fear was overstated. Notification shade *is* the digest UX. iOS 64-cap handles truncation via priority. Removes a class of complexity (timing windows, threshold tuning, lead-verse selection) that was over-engineering for rare cases. |
| 2026-04-29 | Round 4: Re-engagement is invisible plumbing — no Settings toggle. | Caelan: "re engagement won't be a setting to toggle, lowkey, maybe we just secretly allow it if master toggle on." Re-engagement is the safety net of last resort; exposing a toggle just lets users disable the safety net. |
| 2026-04-29 | ~~Round 4: Per-source fire times — Reviews 9am, In progress 6pm, Re-engagement 12pm.~~ **Superseded round 5** — Reviews has no fixed time (fires at clamped `nextDueAt`); In progress and Re-engagement keep their fixed times. | Spreads the day; respects different "moods" per source (morning structure, evening practice, midday re-entry). Source descriptor carries fireTime from v1, supports user config later without rework. |
| 2026-04-29 | Round 4: User-configurable times for visible sources only, v1-if-cheap. | Caelan: "if user config is easy, id say add it, maybe not user config actually for re-engagement." Re-engagement never user-configurable. |
| 2026-04-29 | Round 4: In-progress trigger — every 7 days, fire if any in-progress verse + user not active in last 24h. | Drops round-3 "lead verse practiced once" gate. Weekly habit cadence; 24h activity skip prevents nagging active users. |
| 2026-04-29 | Round 4: Explainer card shown after sign-in completes. | After sign-in, user has a Bread account; card has minimal context to lean on. |
| 2026-04-29 | Round 4: Settings tab badge is "1", not plain dot. | Caelan picked badge form; reads as "something to check," conventional. One-time discovery hint, never returns. |
| 2026-04-29 | ~~Round 4 (revision): Per-verse fire times use a 5-minute random stagger per descriptor, not all-at-same-second.~~ **Superseded round 5** — no batch fire-time at all; verses fire at their actual clamped `nextDueAt`, naturally spread. Sub-second deterministic offset replaces the stagger for the rare same-second collision. | Earlier "same second + iOS coalesces" plan depended on undocumented OS behavior. Math (Monte Carlo) shows even a 5-min stagger drops same-second collision probability to ≤1% at 3 due, ≤9% at 8 due. Solves the buzz-cluster concern without needing the device test. |
| 2026-04-29 | Round 4: Use `CalendarTriggerInput` (wall-clock components) for all schedules — not `DateTriggerInput` (absolute UTC). | Calendar trigger auto-adjusts when user travels across timezones; iOS evaluates match in device's current timezone. Date trigger would mis-fire after timezone change. Descriptor carries wall-clock intent (`fireOn` + `fireAtTimeOfDay`); scheduler converts at schedule time. |
| 2026-04-29 | Round 5: Killed the 9am Reviews checkpoint. Reviews fire at the verse's actual `nextDueAt`, clamped to 8am–10pm local. | The 9am batch was a digest holdover — once we killed the digest, there was no reason to bundle a day's verses into one fire-time. Per-verse-at-due-instant matches user mental model (master 9am Tuesday → next ping ~9am Wednesday) and removes a class of bespoke timing logic (base time + stagger + threshold). Cadence sources (In progress 6pm, Re-engagement 12pm) keep fixed times because they have no SR-derived due-instant to align to. |
| 2026-04-29 | Round 5: Hard-cap pending notifications at 60 (64 minus 4-slot buffer); priority by earliest-due-first. | Per-verse Reviews scales pending count with mastered count. Typical user (~30 mastered) = ~35 pending, fine. Pathological (200+ mastered) hits cap — earliest-due-first means truncation drops the *least* relevant verses. Window stays at 7 days. |
| 2026-04-29 | Round 5: Sub-second deterministic offset (hash of descriptor ID → 0–999ms) for same-second collisions. | Two verses with identical `nextDueAt` second is rare (would require sessions completed within the same second N days ago). Determinism prevents reschedule jitter. |
| 2026-04-29 | Round 5b: One-at-a-time per-verse scheduling. No 7-day rolling window. | Caelan caught the rolling window was over-engineering. With per-verse fire-at-due-instant, each mastered verse owns one pending Reviews notification at any moment; reviewing the verse replaces it with the next one. Slider changes apply only to *future* SR computations — matches user mental model. Also drastically simplifies pending-cap math (N pending = mastered count, not 5×7). |
| 2026-04-29 | Round 5b: Off-toggle confirmation modals. | Master OFF and per-source OFF both require a confirmation step ("Turn off? You won't get reminders…"). Turning ON is unconfirmed. Reasoning: turning off is destructive (cancels pending state); turning on is reversible. Settings notifications section becomes its own page so the modal has a natural home. |
| 2026-04-29 | Round 5b: In-progress activity-skip uses app foreground (not in-progress-specific activity). | Per-collection activity tracking adds state for marginal benefit. Caveat: a user who opens the app daily but never practices in-progress verses won't be nudged. Acceptable — engaged-with-mastered is their choice. |
| 2026-04-29 | Round 5b: Foreground-fire stale-shade behavior — do nothing in v1. | When a notification fires while the app is foregrounded and the user reviews the verse during that session, the now-stale already-delivered notification stays in the iOS shade. v1 leaves it; tapping deep-links to library which gracefully shows current state. Can add `dismissNotificationAsync` later if production feedback warrants. |
| 2026-04-29 | Round 5b: Notification preferences are device-level. Sign-out preserves them. | Matches `colorMode` and `bibleVersion`. Personal-device default; shared-device users will see propagation. Acceptable — alternative (account-level) starts every sign-in fresh and risks users forgetting to opt back in. |
| 2026-04-29 | Round 5b: First-time sign-in initializes `lastForegroundedAt` to now. | Otherwise Re-engagement's 14-day rule has nothing to compare against and could fire on day 1. |
| 2026-04-29 | Round 5b: Q17 testing strategy locked — dev menu + `NOTIFICATION_DEBUG_OFFSET_MS` time-shift + pure-function unit tests + real-device sanity test. | Notifications are delayed events; without tooling iteration loop is "wait until tomorrow." Dev menu lets you fire-now, view pending, force reconcile. Time-shift env var compresses real scheduling to seconds. |
| 2026-04-29 | Round 5b: Q18 extensibility contract locked — 6-step add-a-source recipe; hard rules enforced via TypeScript + lint. | The "platform" promise from round 1 was at risk of erosion as the doc grew; explicit contract makes future-source addition truly additive. Sources can't call iOS, can't subscribe to events, can't know about other sources (one documented exception). Copy lives in `copy.ts`. Source `id` is stable. |
| 2026-04-29 | Round 5c: Reviews source uses `DateTriggerInput` (absolute instant); cadence sources use `CalendarTriggerInput` (wall-clock). | Verified `expo-notifications` SDK 54 source. Earlier rounds tried calendar-trigger-everything but Reviews don't *need* wall-clock semantics — they fire at the absolute moment SR computed (clamped `nextDueAt`). Date triggers are simpler and avoid the TZ-jump silent-miss the agent flagged. Cadence sources keep calendar triggers because "6pm local" should follow the user. |
| 2026-04-29 | Round 5c: Re-engagement gate simplified — drop "no other source has notification queued"; keep only "user inactive 14+ days". | Per-verse Reviews always has descriptors queued for users with mastered verses, so the cross-source gate effectively never triggered. Re-engagement was silently broken. Simplification also removes the cross-source-purity leak (Q18). |
| 2026-04-29 | Round 5c: Legacy `nextDueAt: null` mastered verses get NO Reviews descriptor. | The in-app review view already shows them as "due now" (existing `isDueForReview` behavior). Scheduling notifications for them would dump dozens on existing users post-update. They get notifications only after their first qualifying review establishes `nextDueAt`. |
| 2026-04-29 | Round 5c: Concurrent reconcile gate spec — single in-flight, trailing coalesce, cancel-all overrides. | Senior review correctly flagged that "trust intuition" was wrong delegation for a load-bearing race-condition mitigation. Now spec'd: pseudo-code in Q7. |
| 2026-04-29 | Round 5c: Cap-aware reconcile ordering — always cancel-before-schedule. | Reconcile is non-atomic; near the iOS 64-cap, cancel-then-schedule keeps in-flight count safe. Reverse order risks momentary cap exceedance and rejected schedules. |
| 2026-04-29 | Round 5c: Heavy-user cap behavior documented — earliest-due-first; later verses queued internally; no digest fallback. | A 200-mastered user gets the soonest 60 verses scheduled; the rest fill slots as they free. Eventually all verses fire. Re-engagement at 14d catches truly inactive users. Avoids re-introducing digest complexity. |
| 2026-04-29 | Round 5c: Off-toggle modal uses pessimistic toggle state (no flip until confirmed). | Optimistic flip + cancel = disorienting flicker. Pessimistic matches iOS Settings patterns. |
| 2026-04-29 | Round 5d: Killed the 8am–10pm awake-window clamp. Reviews fire at exactly `nextDueAt`. | Caelan: "if we're gonna do that, we might as well just do digest. I do not care if they get buzzed at 2 a.m. Most people use do not disturb." The clamp added a class of edge cases (late-night cluster at 8am, post-reconcile drift, sub-second collisions, legacy null-due interaction) for marginal benefit. v1 is simplest possible: `DateTriggerInput(nextDueAt)`, done. DND handles 2am cases. Quiet hours / clamp can be re-added as a user setting if production feedback warrants. |
| 2026-04-29 | Round 5d: Q12 permission flow expanded — `provisional` is a fourth UI state. | iOS 12+ provisional grants deliver quietly (no banner/sound). Prior 3-state design treated provisional as `granted` — users would think notifications are on while never seeing one. Added quiet-delivery subtitle with graduate-to-full call. |
| 2026-04-29 | Round 5d: Q12 toggle UI uses loading state (no optimistic flip) during `requestPermissionsAsync`. | Optimistic-on then snap-back when user denies is jarring. Loading state is honest about what's happening. |
| 2026-04-29 | Round 5d: Q12 cold-start persists last-known permission status to AsyncStorage to prevent flicker. | `getPermissionsAsync` is async; without persisted state, Settings paints "enable" then snaps to "denied" 100ms later. |
| 2026-04-29 | Round 5d: Q12 cancels all scheduled notifications on `granted → denied` external revoke. | iOS would silently drop already-scheduled locals once permission is revoked, but our scheduler model would still believe they're queued — drift on next reconcile. |
| 2026-04-29 | Round 5d: Q1 + Q12 — pre-check permission status before tapping Enable; route to iOS Settings if already denied. | iOS remembers prior denials across uninstalls. `requestPermissionsAsync` would silently no-op for these users; Enable button would do nothing visible. |
| 2026-04-29 | Round 5d: Q14 badge guards on `!q1CardCurrentlyMounted` to prevent card + badge co-occurrence. | Both derive from same dismissal flag but render independently; possible to see both at once. Looks broken. |
| 2026-04-29 | Round 5d: Q1 dismissal flag written only on terminal user action, not card mount. | Sign-out mid-card would otherwise leave the flag inconsistent. |
| 2026-04-29 | Round 5d: Q12 toggle/button taps gated by in-flight ref. | Double-tap shouldn't fire `requestPermissionsAsync` twice. |
| 2026-04-29 | Round 5d: Q12 error handling — `Linking.openSettings` failure shows toast; `getPermissionsAsync` failure treats as `undetermined`. | Defensive against rare bridge errors / MDM-restricted devices. |

## Next step

1. Promote this doc from `planning` to `building`, fill in the full
   Technical Approach + Build order.
2. Implement.
