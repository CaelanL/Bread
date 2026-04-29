# Feature: Notification System

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Reframed:** 2026-04-29 (round 6) — switched from per-verse live
> notifications to a **daily digest** for Reviews. Review system itself
> changes too: `nextDueAt` rounds down to local midnight at write time.
> The earlier rounds' history is preserved in the Decisions Log and in
> git (commit `c6aa654` on branch `feat/notification-system-rewrite`).
> **Shipped:** —
>
> **Depends on:** `docs/features/review-system.md` — already shipped on
> main. The midnight-snap change in this doc modifies one function
> (`nextDueAfterDays`) inside the review system; nothing else in that
> system changes.

## Why a digest instead of per-verse pings

Earlier rounds (1–5d) designed a per-verse live notification model:
each mastered verse owned one pending iOS notification at exactly its
`nextDueAt` instant. Rich iOS-quirk handling (64-cap budgeting, sub-
second collisions, legacy null-due rows, queue priority for heavy
users, two trigger types) accreted around it.

Round 6 collapses all of that. The digest model:

- **Future-proofs heavy users.** A user with 200 mastered verses gets
  one daily digest at 9am, not 60 staggered pings or a queued tail.
- **Eliminates iOS cap math entirely.** Worst case: 1 Reviews
  descriptor + 1 In-progress + 1 Re-engagement = 3 pending. The
  64-cap can't be hit by design.
- **One trigger type for every source** (`CalendarTriggerInput`).
  No date-vs-calendar split.
- **No same-second collision logic, no null-due special case, no
  cap-aware reconcile ordering, no priority queue.** All gone.

The cost is a delay — up to 24h between "verse becomes due" and "user
gets pinged." For SR intervals of 1d / 3d / 7d / 14d / 30d / etc., a
sub-day delay is noise. Caelan: *"I do not mind changing the review
system. I just coded it, and nothing's shipped to the App Store yet."*

To make the delay deterministic and predictable, the review system's
`nextDueAt` is **rounded down to local midnight at write time**. A
verse mastered Tuesday at 9:01am becomes due Wednesday 12:00am local.
The user can review it any time Wednesday — including 9am when the
digest fires.

## Problem

Once the review system shipped, the app knows when verses are due —
but the user has to open the app to find out. More broadly, **Bread
has no outbound nudge layer at all**. Every motivational signal is
in-app: badges, counts, streaks, the home tab. Casual users miss
all of it because they don't open the app.

A push layer fixes that, but if we build it as a one-off "review
reminder" feature it'll calcify into a thing we can't extend. So the
problem is two-layered:

- **Immediate**: review-due verses need to nudge the user.
- **Underneath**: a clean, extensible notification *system* future
  features can plug into without re-learning iOS quirks.

## Solution shape (high level)

A **notification platform** in `lib/notifications/` with three layers:

1. **Sources** — pure modules that, given current app state, declare
   what notifications they want scheduled. Each owns its logic and
   copy templates.
   - `sources/reviews-digest.ts` — one descriptor at a time. Fires at
     the user's chosen wall-clock time (default 9am local). Body is
     composed from the verses due as of fire-time.
   - `sources/in-progress.ts` — weekly nudge (default 6pm local).
     Names the most-recently-practiced in-progress verse.
   - `sources/re-engagement.ts` — invisible. Fires once when the user
     has been inactive 14+ days (default 12pm local).
2. **Scheduler** — a single module owning all `expo-notifications`
   calls. Sources never call iOS directly.
3. **Preferences** — AsyncStorage-backed user settings (master toggle,
   per-source toggles, fire times), exposed via a hook.

iOS local notifications only in v1. No APNs, no edge function cron,
no server push.

## Coupled review-system change

The **only** change to the review system: `nextDueAfterDays` in
`lib/store/review.ts:39` rounds the computed instant down to local
midnight before returning.

```ts
export function nextDueAfterDays(now: Date, daysFromNow: number): string {
  const target = new Date(now.getTime() + daysFromNow * MS_PER_DAY);
  target.setHours(0, 0, 0, 0); // local midnight, round down
  return target.toISOString();
}
```

**Behavior:**
- Master a verse at 9:01am Tue with 1-day interval → `nextDueAt =
  Wed 12:00am local` (effectively a 15-hour wait, not 24).
- Master at 11:59pm Tue with 1-day interval → `nextDueAt = Wed
  12:00am local` (effectively a 1-minute wait).
- Master at any time with 14-day interval → `nextDueAt = day-14
  12:00am local`.

**Round direction:** down (toward earlier). Justification: for the
first-review case (1d interval), round-up would make "review tomorrow"
become "review the day after tomorrow," which is worse UX than the
intended "review tomorrow." For longer intervals the rounding error
is sub-day on a multi-week schedule — invisible.

**Timezone:** local midnight is computed against the device's current
TZ at the moment SR runs. If a user travels mid-interval (PST → EDT),
the verse becomes due at the absolute UTC instant we computed (which
displays as 3am EDT instead of midnight EDT). Mild one-day artifact;
acceptable. We do **not** re-round on TZ change.

**Migration:** none. Old clients in the wild keep computing hour-
precise `nextDueAt` values when they review — readers
(`isDueForReview`, `daysUntilDue`, `lockedVersesFor`, the digest
source) all do the same `now >= nextDueAt` comparison either way, so
mixed-precision values across users self-resolve as old clients
update. CLAUDE.md invariant 11 (additive-only migrations) doesn't
apply because there's no schema change at all.

**Downstream readers — verified unchanged:**
- `isDueForReview` (`lib/store/review.ts:113`) — `now >= nextDueAt`
  comparison works at any precision.
- `daysUntilDue` (`lib/store/review.ts:127`) — `Math.ceil` of the
  diff; will mostly produce whole-day values now.
- `lockedVersesFor` (`lib/store/review.ts:174`) — same comparison.
- `formatTimeUntilDue` (`lib/store/review.ts:158`) — its `<24h`
  branches become uncommon for review timing (still correct;
  formatter is also used by Setup screen).
- `computeNextSrState` early-review path (`lib/store/review.ts:88`) —
  unchanged. Early reviews still don't bump `passCount`.

## Requirements

### Must have

- [ ] iOS local notifications for review-due verses, delivered as a
      daily digest.
- [ ] `nextDueAt` midnight-snap in `lib/store/review.ts`.
- [ ] Source-based architecture so adding a future source is
      additive (new file + registration), not invasive.
- [ ] Settings UI: master on/off, per-source toggles (Reviews,
      In-progress), digest cadence/time picker for Reviews.
- [ ] Permission flow: in-app explainer card after sign-in, graceful
      handling of denial with deep-link to iOS Settings, no
      programmatic re-prompt.
- [ ] Notification tap deep-links to the right surface (Reviews
      digest → library review view).
- [ ] AsyncStorage prefs survive `clear()` (sign-out) like other
      device prefs.

### Nice to have

- [ ] Re-engagement source ships as invisible plumbing (no toggle).
- [ ] User-configurable fire-time for In-progress source.
- [ ] Foreground notification handler (in-app banner vs silent).

### Explicitly out of scope (v1)

- Server-side push (APNs / FCM).
- Cross-device dismissal (review on phone A → cancel on phone B).
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- User-configurable quiet hours (DND covers the case).
- Android-specific behaviors beyond `expo-notifications` defaults.
- Per-verse hour-precise notification firing.

## Architectural decisions

### Multi-source platform, not review-only feature

Same as round 1. Source interface is small enough that the upfront
cost is bounded; the second source (In-progress) is the real test of
whether the abstraction is right.

### Sources are pure functions of state

A source exports:

```ts
type NotificationDescriptor = {
  id: string;             // stable; e.g. "reviews-digest:2026-05-01"
  title: string;
  body: string;
  category: NotificationCategory;
  deepLink?: string;
  fireOn: { year: number; month: number; day: number };
  fireAtTimeOfDay: { hour: number; minute: number };
};

type NotificationSource = {
  id: string;
  enabled: (prefs: Preferences) => boolean;
  describe: (state: AppState, prefs: Preferences, now: Date)
    => NotificationDescriptor[];
};
```

All three sources emit wall-clock components. The scheduler always
uses `CalendarTriggerInput` — iOS evaluates wall-clock components in
the device's current timezone, so travel and DST handle themselves.

The scheduler calls `source.describe(...)` whenever it reconciles.
Sources do not subscribe, do not schedule, do not call
`expo-notifications`.

### Scheduler owns all reconciliation

One reconcile function: gather descriptors from enabled sources →
diff against OS pending list → cancel removed, schedule added. With
worst-case 3 pending descriptors total, the diff is trivially cheap.

## Open Questions

Settled answers below. Round 6 simplifies several questions out of
existence (Q6 / Q11 / Q16 in the old numbering); they're left
documented for the audit trail in the Decisions Log.

- **Settled:** Q1 (explainer card after sign-in), Q2 (master + 2
  visible toggles), Q3 (in-progress copy), Q4 (digest cadence/time),
  Q5 (foreground suppress), Q6 *(was 64-cap math; obsolete — digest
  has 1 descriptor)*, Q7 (foreground-only reconciliation, simplified
  trigger list), Q8 (deep-link to collection, never auto-start), Q9
  (verse references in copy), Q10 (no migrations), Q11 *(was per-
  verse-vs-digest; settled = digest)*, Q12 (state-aware master
  toggle, four states), Q13 (re-engagement: 14d, last-resort,
  invisible), Q14 (Settings tab "1" badge), Q15 (per-source fire
  times), Q16 *(was timezone trigger-type split; obsolete —
  calendar-only now)*, Q17 (testing strategy), Q18 (extensibility
  contract).

---

### Q1: When do we ask for notification permission?

**Generic in-app explainer card after sign-in completes, one-time per
device.**

- Card behavior, dismissal flag timing, install-after-uninstall
  pre-check, copy direction — **unchanged from round 3–5d**. See
  Decisions Log for history; behavior locked.
- Two actions: **Enable** (triggers iOS prompt — but only if
  permission status is `undetermined`; if `denied`, route to
  `Linking.openSettings()` instead) and **Maybe later** (dismisses).
- AsyncStorage key: `notif_explainer_dismissed`. Survives `clear()`.
- Dismissal flag written only on **terminal user action**.

User stories covered:
- *Ana installs Bread, signs in.* Sees card on next launch. Enables.
- *Ben taps Maybe later.* Card never returns automatically. Settings
  + Q14 badge are the recovery path.
- *Cam updates from an older client.* Sees card on next launch
  post-update.
- *Reza reinstalled after previously denying.* Card shows; tapping
  Enable detects existing denial, skips `requestPermissionsAsync`,
  routes to iOS Settings.

---

### Q2: Per-source toggles or master toggle only?

**Master + 2 visible per-source toggles. Re-engagement is invisible.**

```
Notifications
─────────────────────────
[●] Notifications        ← master (state-aware per Q12)
    Reviews              ← per-source
      Cadence: Daily ▾
      Time:    9:00 am ▾
    In progress          ← per-source
```

Re-engagement runs whenever the master toggle is on; no toggle, no
display in Settings. Per-source toggles are disabled when master is
off.

Defaults when permission granted: both visible toggles **on**.

---

### Q3: What's the "in progress" nudge actually saying?

**One notification per fire, names the most-recently-practiced
in-progress verse, deep-links to the in-progress collection.**

Unchanged from round 3.

- Trigger: every 7 days, AND ≥1 in-progress verse exists with
  `bestAccuracy != null`, AND user has not foregrounded in 24h.
  (`isInProgressVerse` predicate in `lib/store/index.ts:1043`.)
- Copy direction: *"Psalm 23 is waiting — pick up where you left off."*
- Tap target: `IN_PROGRESS_COLLECTION_ID`
  (`lib/store/index.ts:53`).

---

### Q4: Reviews digest — cadence and fire time

**Daily digest by default, 9:00 am local. Cadence and time are
user-configurable in Settings.**

Cadence options:
- **Daily** (default) — every day at chosen time.
- **Weekly** (chosen weekday at chosen time).

The digest source's `describe()`:

```
1. Read prefs: cadence + time.
2. Compute nextFireTime = next matching wall-clock instant from now.
3. dueAtFireTime = verses where nextDueAt <= nextFireTime
                   AND verse is mastered.
4. If dueAtFireTime is empty:
   - Walk forward day-by-day looking for the next fire-time with
     ≥1 due verse. Cap the walk at 365 days; beyond that, schedule
     nothing.
   - If found, schedule there.
5. Compose body from dueAtFireTime (Q9 below).
6. Return one descriptor (or zero).
```

Body is **fixed at schedule time**, not fire time (iOS limitation —
`expo-notifications` doesn't support fire-time content). The
scheduler reconciles when state changes that affect the body — see
Q7. Drift between schedule and fire is bounded to "verses the user
reviews or masters in the gap"; foreground reconcile self-heals.

**Fire-time-already-passed:** if today's chosen fire-time is in the
past at schedule moment, walk forward to tomorrow.

**Empty-digest behavior:** suppressed entirely. No "no reviews
today" copy. The user only gets pinged when there's actually
something due.

---

### Q5: Foreground behavior

**Suppress in foreground.** Foreground handler returns
`shouldShowBanner: false`, `shouldShowList: false`. Notifications
still get *delivered* (appear in OS shade once user backgrounds), they
just don't pop a banner mid-app.

---

### Q6: ~~iOS pending-notification cap (64) — how do we budget?~~ *(obsolete — digest has 1 Reviews descriptor)*

Round 6 collapsed this question entirely. Worst case:
- Reviews digest: 1 pending
- In-progress: 0 or 1 pending
- Re-engagement: 0 or 1 pending

**Total: 0–3 pending.** The 64-cap is unreachable. All cap-aware
reconcile ordering, priority queueing, sub-second collision logic,
and heavy-user queue behavior from rounds 5–5c are deleted.

---

### Q7: When does the scheduler reconcile?

**Foreground-only reconciliation. Five triggers** (down from twelve in
round 5c):

| # | Trigger | Source code | Why |
|---|---|---|---|
| 1 | App foregrounds | `app/_layout.tsx` AppState listener | permission re-check; correct any drift between our model and iOS |
| 2 | `updateVerseProgress` | `lib/store/index.ts:805` | a new verse mastered or a due verse reviewed changes today's/tomorrow's digest body |
| 3 | Notification preference change | `lib/notifications/preferences.ts` setter | toggle on/off, cadence change, time change |
| 4 | Sign-in completes | `lib/auth/context.tsx` | new user state; rebuild |
| 5 | `clear()` (sign-out) | `lib/store/index.ts:948` | cancel ALL pending; do NOT re-schedule |

**Triggers we deliberately don't handle anymore** (vs round 5c):
- `addVerse`, `deleteVerse`, `resetVerseProgress`,
  `setReviewMaxIntervalDays`. None of these change *today's*
  Reviews digest body in a way the user notices. `addVerse` adds an
  in-progress verse (digest source ignores). `deleteVerse` /
  `resetVerseProgress` of a mastered verse might shift "and N more"
  by one — accepted as mild staleness; foreground reconcile heals.
  `setReviewMaxIntervalDays` only affects future SR computations
  (no current-pending change).
- iOS clearing the queue without our knowledge — self-heals on next
  foreground via mode "full."

**Reconcile modes:**
- **full** — read all enabled sources, diff against OS pending
  list, cancel removed, schedule added.
- **source-scoped** — same as full but only one source's
  descriptors. Used for per-source preference toggles.
- **cancel-all** — wipe iOS queue, no re-schedule. Used on sign-out
  and external permission revoke.

**Concurrent reconcile gate** *(unchanged from round 5c)* — single
in-flight, trailing coalesce, `cancel-all` overrides:

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
      reconcile('full');
    }
  }
}
```

**Self-healing:** partial-failure reconciles leave drift; the next
`mode: 'full'` reconcile does a fresh diff and corrects it. No retry
logic.

---

#### Q7.1: Walkthrough — what happens when the user does X?

For each user action, what changes in the notification queue.

**1. User adds a verse.** Verse is in-progress (not mastered).
In-progress source's eligibility may add a candidate "lead verse."
Reviews digest unaffected. **No reconcile** (we deliberately don't
hook `addVerse`); next foreground or `updateVerseProgress` will
reconcile and pick up the new state.

**2. User practices a verse without mastering.** `bestAccuracy` and
`lastPracticedAt` update. In-progress source's lead-verse pick may
change. **Reconcile fires** via `updateVerseProgress` (#2 in trigger
table) — even non-mastery sessions hit this action.

**3. User masters a verse.** SR computes `nextDueAt` (now midnight-
snapped). Verse moves in-progress → mastered. Reviews digest body
may now include this verse if it's due before the next fire-time.
**Reconcile fires** via `updateVerseProgress`.

Master at 9:01am Tue with 1d interval → `nextDueAt = Wed 12:00am`.
Wednesday 9am digest fires with this verse in the body.

**4. User reviews a verse that was due.** SR computes a new
`nextDueAt` further out (midnight-snapped). The verse drops out of
today's digest. **Reconcile fires** via `updateVerseProgress`. Body
recomposes; if other verses still due, body updates "and N more"
counts. If user reviewed the only due verse, body becomes empty —
reschedule walks forward to next non-empty digest day.

**Edge case (notification fires while app foregrounded):** Q5
suppresses the banner; iOS still delivers to the shade. If user
reviews the verse during the open session, the now-stale shade
entry remains. **v1 leaves it** (locked round 5b). Tapping deep-
links to library which gracefully shows current state.

**5. User deletes a verse.** Soft delete. **No reconcile.** Mild
staleness in body if the deleted verse was named in pending body.
Acceptable; foreground reconcile heals. Already-delivered
notifications referencing the deleted verse are not retroactively
removed — iOS limitation.

**6. User resets a verse's progress.** Mastered → in-progress.
**No reconcile.** Same staleness reasoning as #5.

**7. User changes Reviews max-interval.** Slider only affects
**future** SR computations. **No reconcile** (already-pending
descriptor reflects current state correctly; future reviews will
use new cap). Caelan flagged this explicitly.

**8. User toggles a notification setting.**

- **Master OFF** → confirmation modal: *"Turn off all notifications?
  You won't get review reminders or other nudges until you turn them
  back on."* Pessimistic toggle (stays on until confirmed). Reconcile
  in `cancel-all` mode.
- **Master ON** → no confirmation. Reconcile in `full` mode.
- **Per-source toggle OFF** → confirmation modal scoped to source.
  Pessimistic. Reconcile in `source-scoped` mode.
- **Per-source toggle ON** → no confirmation. Source-scoped reconcile.
- **Cadence / time picker change (Reviews)** → no confirmation.
  Source-scoped reconcile.
- **Time picker change (In-progress)** → no confirmation.
  Source-scoped reconcile.

Modals match iOS Settings' "Delete Account" pattern (no flip until
confirmed). Settings notification section is its own page so modals
have a natural home.

**9. User signs out / signs in.**
- Sign-out: `cancel-all` reconcile. Notification *preferences*
  persist (device-level — locked round 5b, matches `colorMode`
  and `bibleVersion`).
- Sign-in: `full` reconcile from scratch. Sets
  `lastForegroundedAt = now` for first-time sign-in so Re-engagement
  doesn't fire on day 1.

**10. User opens the app (foreground).** `full` reconcile.
Re-checks iOS permission. `lastForegroundedAt` updates.

**11. User travels / changes timezone.** Calendar triggers
auto-evaluate in the device's current TZ — all three sources adjust
their wall-clock fire-time to the new locale automatically. The
mid-interval `nextDueAt` artifact (verse computed at PST midnight,
displayed at 3am EDT) is the only oddity; one-day, accepted.

**12. User toggles iOS-level permission in iOS Settings.** Detected
on next foreground via `getPermissionsAsync()`.
- Granted → denied: `cancel-all` reconcile.
- Denied → granted: `full` reconcile from scratch.

**Edge cases surfaced in earlier rounds, still relevant:**
- *Mid-session notification fires* — Q5 suppresses (foreground).
- *Cold-start notification* — iOS treats splash as foreground.
  Suppressed.
- *Multiple devices same account* — out of scope (cross-device
  dismissal).
- *First-time user with zero verses* — empty digest, schedules
  nothing. Works.
- *Account switch on shared device* — preferences leak (device-
  level). Locked round 5b as acceptable.
- *Bible version change mid-flight* — moot (copy is reference-only,
  Q9). Build note: revisit if copy ever includes verse text.

---

### Q8: Where does the notification deep-link land?

**Always to a collection. Never auto-start a session.**

- **Reviews digest** → library, filtered to review view (existing
  route `/(tabs)/(library)?reviewView=true`).
- **In progress** → in-progress collection (`IN_PROGRESS_COLLECTION_ID`).
- **Re-engagement** → in-progress collection if any verses are
  in-progress, otherwise mastered collection if any, otherwise home.

---

### Q9: Verse text in notification payloads

**Reference only, not full verse text.** Round-2 settled. Caelan: *"no
privacy concern in my head, it's just a Bible verse."*

**Reviews digest body composition** (locked round 6):
- 0 due → suppress (no descriptor scheduled).
- 1 due → *"Psalm 23 is ready for review"*
- 2+ due → *"Psalm 23 and N more ready for review"*

**Title:** *"Review time"*

**Hero verse pick when 2+ due:** any deterministic pick from the due
set. Earliest-due is fine but ordering is invisible to the user
(they're all due). Build note: pick a stable ordering (e.g. by
`addedAt` ascending) so the body doesn't reshuffle on cancel/
reschedule churn.

---

### Q10: Migration concerns

**None.** Client-only feature. No Supabase migrations, no edge
functions, no schema changes. Doesn't face CLAUDE.md invariant 11.

The `nextDueAt` rounding change to `lib/store/review.ts` is also
schema-free — old clients keep computing hour-precise values; new
clients keep computing midnight-snapped values; both are ISO strings
in the same column; readers compare with `>=` and don't care about
precision.

`expo-notifications` requires a native rebuild — this can't ship via
Expo updates, needs a new binary.

---

### Q11: ~~Per-verse vs digest~~ *(settled — digest)*

Round 6: digest. Reasoning at the top of this doc. Earlier rounds'
"per-verse always, fire at exact `nextDueAt`" model is preserved
in git (commit `c6aa654`).

Triggers to revisit this decision:
1. Production data shows the up-to-24h delay is genuinely confusing
   (expected: rare, since SR intervals are ≥1d).
2. User feedback that the digest feels less personal than per-verse
   pings would.
3. A future product direction wants per-verse hour-precise control
   for some other reason.

None require re-architecture; switching back is "edit one source
file" — `sources/reviews-digest.ts` becomes a per-verse emitter.
The platform abstraction holds.

---

### Q12: How does Settings behave under iOS permission states?

**State-aware master toggle. Four permission states.** *Unchanged
from round 5d.*

1. **`undetermined`** — toggle enabled; flipping on triggers iOS
   prompt.
2. **`granted`** — toggle works normally; per-source toggles
   interactive.
3. **`provisional`** — toggle ON with subtitle *"Delivering quietly —
   tap to allow banners & sound."* Subtitle tap calls
   `requestPermissionsAsync({ ios: { allowAlert: true, allowSound:
   true, allowBadge: true } })` to graduate.
4. **`denied`** — toggle disabled, replaced with **"Enable in iOS
   Settings"** button deep-linking via `Linking.openSettings()`.
   Explainer below.

**Detection of external changes:** `getPermissionsAsync()` on every
foreground.

**`granted → denied` transition:** call
`cancelAllScheduledNotificationsAsync()` and clear internal model.
iOS silently drops scheduled locals once permission revoked; without
this our model would believe they're queued.

**Cold-start hydration:** persist last-known status to AsyncStorage;
paint optimistically; async resolution updates if differs. Skeleton
on first-ever launch.

**Toggle UI during `requestPermissionsAsync()`:** loading state, no
optimistic flip. Tap-gated by an in-flight ref.

**Install-after-uninstall:** pre-check permission. If `denied`, skip
the request, route to `Linking.openSettings()` with copy
*"Notifications were turned off — open iOS Settings to re-enable."*

**Q1 + Q14 mutual exclusion:** Q14 badge guards on
`!q1CardCurrentlyMounted`.

**Error handling:**
- `Linking.openSettings()` failure → toast: *"Couldn't open Settings.
  Open the iOS Settings app and find Bread under Notifications."*
- `getPermissionsAsync()` rejects → treat as `undetermined`.

---

### Q13: Re-engagement source

**Invisible plumbing. 14-day inactivity threshold. Single-shot per
quiet period. Fires at 12pm local.** *Unchanged from round 5c.*

Trigger rule:
- User has been inactive (no app foreground) for 14+ days, AND
- Re-engagement source has not fired during this quiet period.

**No cross-source gate** (round 5c removed it; the digest also
doesn't change this since the "queue" check was structurally broken
in any model where Reviews always has descriptors). Re-engagement
fires purely on inactivity.

Rearm: source rearms when user opens the app. Once they return to
quiet for 14+ days, can fire again.

Copy: *"It's been a while. Come build your memorization habit."*

Tap target: per Q8.

`lastForegroundedAt` initialization: set to `now` on first-time
sign-in so day 1 doesn't trigger.

---

### Q14: Settings tab nudge badge

**"1" badge on Settings tab** when *all* of:
- Q1 explainer card has been dismissed.
- Q1 card is NOT currently mounted (round 5d guard).
- iOS permission status is `undetermined` OR `denied`.
- User has at least 1 verse in their library.

Badge disappears on first Settings visit. Never reappears. One-time
discovery hint, not a perpetual nag.

---

### Q15: Per-source fire timing

| Source | Fire time | User-configurable? |
|---|---|---|
| Reviews digest | 9:00 am local (default), daily cadence | **Yes** — cadence (daily/weekly) and time |
| In-progress | 6:00 pm local, every 7 days | v1-if-cheap (time only) |
| Re-engagement | 12:00 pm local, on 14d-inactive trigger | **No** (invisible) |

In-progress trigger gating *(unchanged from round 4)*:
- ≥1 in-progress verse exists with `bestAccuracy != null`
  (`isInProgressVerse`, `lib/store/index.ts:1043`).
- AND 7+ days since last in-progress notification fired.
- AND user has not foregrounded the app in last 24h.

---

### Q16: ~~Timezone — date trigger vs calendar trigger~~ *(obsolete — calendar-only)*

Round 6: all three sources use `CalendarTriggerInput`. The earlier
two-trigger-type split (Reviews on `DateTriggerInput` for absolute-
instant precision, cadence sources on `CalendarTriggerInput`) is
gone with the digest reframe — Reviews are now wall-clock too.

Travel and DST: iOS calendar triggers automatically re-evaluate in
the device's current timezone. No code on our side.

**Fire-time-already-passed** (only relevant for calendar triggers):
year-month-day-hour-minute pinned in the past would roll to **next
year**. Mitigation: scheduler rolls forward to next valid occurrence
(tomorrow's chosen time) before scheduling.

The mid-interval `nextDueAt` artifact discussed under "Coupled
review-system change" — verse computed at PST midnight displays as
3am EDT after travel — is unrelated to the trigger type. It's a
property of how we round at SR-write time. Acceptable.

---

### Q17: Testing strategy

*Unchanged from round 5b.* Notifications are delayed events; without
tooling iteration is "wait until tomorrow." v1 needs both copy and
timing iteration to be fast.

**Build-time tooling:**

1. **Dev menu** (long-press on Settings row in `__DEV__`):
   - "Fire each source's notification *now*"
   - "Show pending iOS notifications"
   - "Force reconcile"
   - "Reset notification state"

2. **`NOTIFICATION_DEBUG_OFFSET_MS` env var** — `__DEV__`-only.
   Subtracts offset from every fire-time so "fire at 9am tomorrow"
   becomes "fire 5 seconds from now." Calendar triggers in dev
   mode are overridden to `DateTriggerInput(now + offset)` to
   support this.

3. **Unit tests** for pure functions:
   - Each source's `describe()` (eligibility, descriptor IDs).
   - Scheduler's diff logic.
   - Source registration test (unique IDs, valid `describe()`).
   - **`nextDueAfterDays` midnight-snap behavior** — new test:
     mastering at any time-of-day produces the same `nextDueAt`
     for the same `daysFromNow`.

4. **One real-device sanity test before ship.** Master a verse,
   background app, wait for digest fire-time, tap, verify
   deep-link. Repeat for each source.

**Copy iteration:** copy lives in `lib/notifications/copy.ts`
(see Q18). Edit → save → Metro hot-reloads → trigger via dev menu →
<2s feedback.

What works on simulator (~80%): scheduling, cancelling, fire-on-time,
permission flow, foreground suppression, tap routing, Settings UI.

What requires real device: lock-screen UX, haptic feel, shade
interactions.

---

### Q18: Extensibility contract

*Unchanged from round 5c.* Six-step recipe for adding a source:

1. Create `lib/notifications/sources/<name>.ts` exporting a
   `NotificationSource`.
2. Register it in `lib/notifications/sources/index.ts`.
3. Extend `Preferences.perSource` in `lib/notifications/types.ts`
   (defaults to `false` — opt-in).
4. Add copy entries to `lib/notifications/copy.ts`.
5. Add a Settings UI toggle (or skip if invisible plumbing).
6. Add deep-link route handling to `lib/notifications/deep-links.ts`.

**Hard rules** (TypeScript + lint enforced):
- Sources MUST NOT call `expo-notifications` directly.
- Sources MUST NOT subscribe to events.
- Sources MUST NOT know about other sources.
- Sources MUST NOT define copy inline.
- Source `id` MUST be unique and stable.

---

## Technical sketch

```
lib/notifications/
├── index.ts              # public API: hooks + register
├── types.ts              # NotificationDescriptor, NotificationSource, Preferences
├── scheduler.ts          # the single owner of expo-notifications
├── preferences.ts        # AsyncStorage-backed prefs
├── permissions.ts        # request flow, denial state
├── deep-links.ts         # response handler that routes taps
├── copy.ts               # all copy, namespaced by source
├── debug.ts              # __DEV__-only dev menu
└── sources/
    ├── index.ts          # registers all sources
    ├── reviews-digest.ts # daily/weekly digest, wall-clock fire
    ├── in-progress.ts    # weekly cadence
    └── re-engagement.ts  # 14d invisible
```

Hook surface:

```ts
useNotificationPreferences()    // { master, perSource, reviewsCadence, reviewsTime, ... }
useNotificationPermission()     // { status, request, openSettings }
useNotificationSettingsBanner() // boolean
```

Internal:

```ts
reconcileNotifications()        // called by store actions, prefs, foreground, auth
```

Source registration is static (an array in `sources/index.ts`) — not
runtime-pluggable.

## Edge cases to verify during build

- ✅ User denies, then enables in iOS Settings — Q12 foreground
  re-check.
- ✅ User signs out — Q7 trigger #5 cancels all.
- ⚠️ User changes Bible version — moot for v1 (refs only). Build
  note if copy ever includes verse text.
- ⚠️ iOS upgrades that reset permission — foreground re-check
  detects.
- ⚠️ Scheduled fire-time already passed — calendar trigger would
  roll to next year unless we roll forward to tomorrow.
- ⚠️ Mid-interval timezone change — `nextDueAt` was midnight in old
  TZ, displays 3am in new TZ. Accepted.
- ⚠️ Empty digest day — walk-forward in `describe()` finds next
  non-empty day; 365-day cap.
- ⚠️ Body staleness from `deleteVerse`/`resetVerseProgress` — not
  reconciled; foreground heals.

## What this feature explicitly will NOT add

- Server-side push (APNs / FCM).
- Cross-device dismissal coordination.
- LLM-generated copy.
- Marketing / promotional notifications.
- Streak-save notifications.
- Notifications on web (`expo-notifications` is mobile-only).
- Per-verse hour-precise notification firing.
- User-configurable quiet hours (DND covers it).

---

## Action Items

- [ ] **Agent review of round-6 rewrite.** Diff vs commit `c6aa654`
      (the round-5d baseline) reviewed exhaustively for missed cases,
      regressions, weakened invariants. *(In progress — agent
      dispatched after this doc commits.)*
- [ ] **Add `expo-notifications` config plugin.** SDK 54
      deprecated `notification` field in `app.json`; use the
      plugin form: `["expo-notifications", { ... }]` in `plugins`.
- [ ] **Promote doc to `building`** once review feedback resolved.
      Fill in full Technical Approach (file-by-file) and Build
      order (PR-sized chunks).

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Original stub created, review-only scope. | Split from review-system doc. |
| 2026-04-28 | Reframed as multi-source platform. | Extensibility ask. |
| 2026-04-28 | v1 ships 3 sources: review-due, in-progress, re-engagement. | Validates platform abstraction. |
| 2026-04-28 | Permission asked via in-app explainer card after sign-in. | iOS one-shot; explainer is conventional substitute. |
| 2026-04-28 | Verse references in body, not full text. | "Just a Bible verse" — no privacy concern. |
| 2026-04-28 | Reconciliation foreground-only, no background tasks. | iOS background tasks unreliable. |
| 2026-04-28 | Notification taps land on a list, never auto-start. | Auto-start is intrusive. |
| 2026-04-28 | Round 3 — generic explainer card, one-time, AsyncStorage-managed. | Don't nag. |
| 2026-04-28 | Round 3 — re-engagement = Option B, 14-day, single-shot. | Channel of last resort. |
| 2026-04-28 | Round 3 — Q14 Settings tab nudge badge. | Discovery for card-dismissers. |
| 2026-04-28 | Round 3 — suppress in foreground. | Caelan: don't care for in-app. |
| 2026-04-29 | Round 4 — re-engagement is invisible plumbing. | Don't expose a toggle for the safety net. |
| 2026-04-29 | Round 4 — In-progress trigger: every 7 days, ≥1 in-progress, 24h activity skip. | Weekly habit; don't nag active users. |
| 2026-04-29 | Round 5 — Reviews fired at exact clamped `nextDueAt` (per-verse). | Killed 9am digest holdover; per-verse precision. |
| 2026-04-29 | ~~Round 5 — hard-cap 60 pending, earliest-due-first.~~ **Superseded round 6.** | Per-verse model needed cap math. Digest doesn't. |
| 2026-04-29 | Round 5b — one-at-a-time per-verse Reviews; no rolling window. | Caelan caught over-engineering. |
| 2026-04-29 | Round 5b — off-toggle confirmation modals, pessimistic state. | Match iOS Settings patterns. |
| 2026-04-29 | Round 5b — preferences device-level (sign-out preserves). | Matches `colorMode`/`bibleVersion`. |
| 2026-04-29 | Round 5b — `lastForegroundedAt = now` on first sign-in. | Prevents Re-engagement firing day 1. |
| 2026-04-29 | Round 5b — Q17 testing: dev menu + time-shift + unit tests. | Delayed-events iteration loop. |
| 2026-04-29 | Round 5b — Q18 extensibility: 6-step recipe + hard rules. | Platform promise needs explicit contract. |
| 2026-04-29 | ~~Round 5c — Reviews use `DateTriggerInput`; cadence use `CalendarTriggerInput`.~~ **Superseded round 6.** | Two trigger types collapse to one with digest. |
| 2026-04-29 | Round 5c — Re-engagement gate simplified to "no app foreground 14d." | Cross-source gate was structurally broken. |
| 2026-04-29 | Round 5c — Concurrent reconcile gate spec'd. | Race-condition mitigation. |
| 2026-04-29 | ~~Round 5d — kill 8am–10pm awake-window clamp; fire at exact `nextDueAt`.~~ **Superseded round 6.** | Digest fires at user-chosen wall-clock; clamp moot. |
| 2026-04-29 | Round 5d — Q12 expanded to four states (added `provisional`); cold-start hydration; in-flight gate. | Agent audit findings. |
| 2026-04-29 | **Round 6 — switch from per-verse live to daily digest for Reviews.** | Future-proofs heavy users; eliminates 64-cap math, sub-second collisions, null-due edge case, two-trigger-type split. Cost: up to 24h delay between due-instant and ping. |
| 2026-04-29 | **Round 6 — `nextDueAt` rounds down to local midnight at write time.** | Makes the digest delay deterministic. Master at 9:01am Tue → due Wed 12am, digest at Wed 9am picks it up reliably. |
| 2026-04-29 | **Round 6 — single trigger type for all sources (`CalendarTriggerInput`).** | Digest is wall-clock too; no need for `DateTriggerInput`. Q16 collapses. |
| 2026-04-29 | **Round 6 — reconcile triggers shrink: drop `addVerse`, `deleteVerse`, `resetVerseProgress`, `setReviewMaxIntervalDays`.** | These don't change today's digest body in user-visible ways; foreground reconcile heals any drift. |
| 2026-04-29 | **Round 6 — body composition deterministic.** | Pick stable hero verse (e.g. by `addedAt` ascending) so cancel/reschedule churn doesn't reshuffle copy. |
| 2026-04-29 | **Round 6 — empty-digest days suppressed entirely; walk forward up to 365 days.** | No "no reviews today" copy. Only ping when there's something. |

## Next step

1. Agent review of this rewrite (Action Items #1).
2. Resolve review findings.
3. Promote `planning` → `building`. Fill Technical Approach + Build
   order.
