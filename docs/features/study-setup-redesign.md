# Feature: Study Setup screen redesign

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-05-01
> **Shipped:** —

## Problem

The Study Setup screen (`app/(tabs)/(library)/setup/[id].tsx`) has
three rough edges that compound on small phones (iPhone SE, 13 mini):

1. **Verses-per-chunk picker is amateur-feeling.** It uses
   `react-native-dropdown-picker@5`, which: animates strangely on
   external value changes (one-frame label flash, fixed in 1.1.1
   with a workaround), can't be styled to match the rest of the
   app's iOS-feel design, and the dropdown panel overlaps the
   "Your Progress" card and the play button on small phones.
2. **Layout cramps.** The play button currently sits in a
   `bottomSection` View with `flex: 1` + `justifyContent:
   'space-between'` pushing it to the bottom. On Pro Max there's
   plenty of room; on SE, the chunk picker row and play button
   collide. There's no scroll behavior, so on small phones content
   is *literally* squeezed against the play button.
3. **Play button reads as a video player, not a "start session"
   call-to-action.** It's a circular `play.fill` icon button on a
   gold background. With the rest of the app's typography-led
   design language, a more deliberate primary action would fit
   better.

## Solution

Three coordinated changes to the screen, scoped to one PR:

1. **Replace the dropdown** with a button that opens a centered
   modal (matching `NotificationCadenceModal`'s pattern). Modal
   contains all options as tap-rows, with the "All" option as the
   last row. Selection commits and dismisses. The "All" Pressable
   alongside the dropdown goes away (now a modal row).
2. **Wrap the form body in a `ScrollView`** with bottom padding
   equal to the floating play button's footprint, so on small
   phones the form scrolls and the play button never overlaps
   content. On large phones the form fits and scroll is a no-op.
3. **Float the play button** as an absolutely-positioned element
   anchored to the bottom of the screen (above the safe-area
   inset), with shadow/elevation so it visibly sits above the
   scroll content. Optionally redesigned (open question — see Q1).

The existing `versePreviewLines` screen-height conditional stays
— shrinking preview lines on small phones is the correct behavior
(more form visible above the fold without scrolling).

## Requirements

### Must have

- [ ] Verses-per-chunk uses a custom modal matching the visual
      style of `NotificationCadenceModal`/`NotificationTimeModal`.
- [ ] No more dependency on `react-native-dropdown-picker` (last
      and only consumer is this screen).
- [ ] Form body scrolls cleanly on iPhone SE / 13 mini.
- [ ] Play button never overlaps content on any iOS device size
      currently supported.
- [ ] Play button visually reads as floating (shadow/elevation).
- [ ] On Pro Max sizes, the screen looks at-rest (not stretched,
      no excessive whitespace).
- [ ] Tapping "All" inside the modal sets chunk size to
      `totalVerses`.

### Nice to have

- [ ] Play button redesign (pill vs. larger circle vs. as-is).
      Decide in Q1.
- [ ] A11y: each row in the modal has proper accessibilityLabel +
      role.
- [ ] Modal dismisses on backdrop tap (matches existing pattern).

### Explicitly out of scope

- Other screens of the study flow (the session screen itself, the
  results page).
- Reworking the difficulty segmented control.
- Reworking ProgressCard.
- Adding new inputs to Setup (e.g., a "session length" picker).
- Android-specific tuning beyond what falls out naturally.

## Open Questions

### Q1: Play button shape — RESOLVED

**Decision: Pill** (Option B). Full-width pill near the bottom,
absolutely positioned with shadow/elevation. Copy: TBD during
build (likely "Start session" or "Start"). Reasoning: cleaner
primary-action affordance for a setup screen; the
"Setup → press button → enter session" flow reads more naturally
as a Submit than a Play.

### Q2: When the form fits without scroll, should the play button still float?

Two views:

- **Always float (recommended).** Keep one consistent layout
  rule. ScrollView's bottom padding is constant; the play button
  is always absolutely positioned. Predictable, no
  size-conditional layout logic.
- **Float only when content overflows.** Detect overflow and
  switch the play button between absolute/relative positioning.
  Cleaner on large phones (no padding "wasted") but adds
  conditional logic and risks layout jank on rotation/dynamic
  content load.

**Recommendation: always float.** The bottom padding is invisible
once filled with the play button; there's no real cost on large
phones, and the consistent rule is easier to reason about.

### Q3: Should the screen-height conditional for `versePreviewLines` stay or go?

- **Stay (recommended).** Shrinking preview lines on small phones
  shows more form above the fold without scrolling, which on a
  pre-action setup screen is desirable. The thresholds are
  documented inline (`920` Pro Max, `870` 16 Pro, else SE/mini).
  Switch from `Dimensions.get('window').height` to
  `useSafeAreaFrame().height` so notch/Dynamic Island variance
  doesn't bite us.
- **Remove.** Always show 4 lines, let the user scroll within the
  preview card on small phones if needed. *(Simpler code; but
  forces an extra scroll surface inside an already-scrollable
  screen, which is awkward.)*

**Recommendation: stay, with the safe-area-frame swap.**

### Q4: Should we drop `react-native-dropdown-picker` entirely?

Currently used only in the Setup screen. Removing the dependency
saves ~30KB and a peer-dep tree.

- **Drop.** Simpler `package.json`, cleaner dependency story.
- **Keep around for future selectors.** Avoid in case a future
  picker needs it. *(Weak reason — we'd rather build a single
  reusable modal pattern.)*

**Recommendation: drop.** If we need a generic select later, we
build a `Select` primitive in `components/ui/` that wraps the
custom modal pattern.

## Technical Approach

### Data model changes

None.

### API / edge function changes

None.

### Client changes

- **Files added**:
  - `components/study/ChunkSizeModal.tsx` — the new picker modal.
    Mirrors `components/settings/NotificationCadenceModal.tsx` in
    shape and styling. Renders a list of `1..totalVerses` plus an
    "All" row at the end. Selection is single-select; commits on
    Save (consistent with the notifications modals).

- **Files modified**:
  - `app/(tabs)/(library)/setup/[id].tsx`:
    - Remove `import DropDownPicker`.
    - Remove `dropdownOpen`, `dropdownItems` state and the
      `useEffect` that builds dropdown items.
    - Add `chunkModalOpen` state.
    - Replace the `<DropDownPicker>` + "All" Pressable block with:
      a single Pressable (label = the current selection) that
      opens `ChunkSizeModal`.
    - Wrap the body content in a `<ScrollView>` with
      `contentContainerStyle={{ paddingBottom: PLAY_FLOATING_PAD }}`
      where `PLAY_FLOATING_PAD = playButtonSize + insets.bottom + 24`.
    - Move the `<View style={styles.bottomSection}>` containing
      the play button outside the ScrollView, give it
      `position: 'absolute'` styling anchored to the bottom +
      `insets.bottom + 16`.
    - Switch `Dimensions.get('window').height` to
      `useSafeAreaFrame().height` for the `versePreviewLines`
      conditional.
  - `package.json` — remove `react-native-dropdown-picker`.

- **Files removed**: none.

### State changes

None — local component state only.

### UI

**ChunkSizeModal:**
- Centered card, fade-in backdrop with `BlurView` (matches the
  existing pattern in `ProgressInfoModal`).
- Title: "Verses per chunk"
- Body: `ScrollView` with rows for `1..totalVerses` plus an "All"
  row at the end. Each row has the value (or "All"), with a
  highlighted background when selected. Single tap = select, tap
  Save to commit, tap Cancel to dismiss without changes.
- Buttons: Cancel + Save row at the bottom, matching the
  Notifications modals.

**Setup screen layout:**

```
┌──────────────────────────────────┐
│ ◀  Setup              ⋯  (header)│
├──────────────────────────────────┤
│  ╭───── verse preview ─────╮  ▲  │
│  ╰─────────────────────────╯  │  │
│                                │  │
│  Difficulty   [easy|med|hard]  │  │
│                                │  │
│  Your Progress                 │  │  scroll
│  ╭───── progress card ──────╮  │  │  region
│  ╰─────────────────────────╯  │  │
│                                │  │
│  Verses per chunk    [1   ›]  │  │
│                                │  │
│       (bottom pad ~88pt)       ▼  │
├──────────────────────────────────┤
│           ╭───────╮               │  floating
│           │   ▶   │               │  play
│           ╰───────╯               │  button
└──────────────────────────────────┘
```

### Edge cases

- **Verse not yet loaded** (text fetch in flight): existing
  ActivityIndicator inside the preview card. ScrollView still
  renders, just shows the loader. Unchanged.
- **`totalVerses === 1`**: chunk size row already hidden
  (`totalVerses > 1` gate). Modal never shown. Unchanged.
- **`totalVerses` very large** (~50+): modal's ScrollView
  handles it. No max imposed.
- **Rotation**: `useSafeAreaFrame()` updates on rotation.
  ScrollView re-evaluates content height. Floating button stays
  anchored to bottom-safe.
- **Dynamic font sizes** (iOS accessibility scaling): existing
  hardcoded font sizes don't respect iOS Dynamic Type. Out of
  scope for this redesign — flag for a future a11y pass.
- **iPad**: `supportsTablet: true` in `app.config.js`. The
  redesign should look reasonable but not necessarily optimal.
  Out of scope for explicit iPad tuning.
- **Modal-while-recording or modal-while-loading**: Setup screen
  doesn't record. The verse-text fetch is async but doesn't block
  modal interaction. No interaction.

### What does NOT change

- The verse expansion modal (the maximize-icon → full-passage
  view). Already works fine.
- The difficulty segmented control.
- The `ProgressCard` component.
- The "Reset Progress" popover menu (top-right ⋯).
- The verse-preview rendering logic, including
  `getAnnotatedText()`. Only the line-count source-of-truth
  changes (Dimensions → safe-area frame).
- Navigation / routing.
- The session screen this navigates to.

## Build order

Single PR, in 2 commits for review clarity:

1. **Add `ChunkSizeModal`, swap the dropdown.** Layout untouched.
   Picker is replaced inline; "All" Pressable removed; old
   dropdown imports/state gone. App is in a working state.
   - Files: `components/study/ChunkSizeModal.tsx` (new),
     `app/(tabs)/(library)/setup/[id].tsx` (edited),
     `package.json` (drop dep).
2. **Refactor layout — ScrollView + floating play button +
   safe-area-frame.** No new components; redo the existing
   layout structure.
   - Files: `app/(tabs)/(library)/setup/[id].tsx` only.

(Optional 3rd commit if play-button redesign is in scope —
otherwise defer.)

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-05-01 | Custom modal over `@gorhom/bottom-sheet` or wheel picker | Matches existing app modal patterns; no new dependency; right affordance for ~5–50 discrete options. |
| 2026-05-01 | ScrollView + absolute play button (always floating) | Most conventional iOS pattern; composes cleanly with safe-area; no conditional layout logic. |
| 2026-05-01 | Keep screen-height conditional for `versePreviewLines` | Shrinking preview on small phones is correct behavior; switch source from Dimensions to safe-area frame. |
| 2026-05-01 | Drop `react-native-dropdown-picker` dependency | Last consumer being removed; future selects can build on a `Select` primitive over the modal pattern. |
| 2026-05-01 | Play button = pill (Option B) | Reads as a primary "start" submit affordance; better fit than the iconographic circle for a setup screen. |

## Graduation Checklist

- [ ] Schema changes reflected in `docs/architecture/data-model.md` — N/A
- [ ] New API or cache behavior reflected in `docs/architecture/bible-api-and-caching.md` — N/A
- [ ] New version added to `docs/architecture/bible-versions.md` (if relevant) — N/A
- [ ] Session-loop changes reflected in `docs/architecture/study-session.md` — possibly (if Setup is documented there; light update only)
- [ ] Sync/storage changes reflected in `docs/architecture/sync-and-storage.md` — N/A
- [ ] Auth changes reflected in `docs/architecture/auth.md` — N/A
- [ ] Routing changes reflected in `docs/architecture/navigation-and-routing.md` — N/A
- [ ] UI primitives changes reflected in `docs/architecture/theming-and-ui.md` — yes (new modal pattern; mention it)
- [ ] Library/collection changes reflected in `docs/architecture/library-and-collections.md` — N/A
- [ ] Insights changes reflected in `docs/architecture/insights-and-streaks.md` — N/A
- [ ] Home/VOTM changes reflected in `docs/architecture/home-and-votm.md` — N/A
- [ ] Edge function changes reflected in `docs/architecture/edge-functions.md` — N/A
- [ ] CLAUDE.md routing table updated (if a new architecture doc was added) — N/A
- [ ] CLAUDE.md invariants updated (if a new load-bearing rule emerged) — N/A

## What Was Built

(Filled in when shipped.)
