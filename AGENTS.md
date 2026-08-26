# AGENTS.md

Entry point for Codex agents working in this repo. Read this
first, then check the routing table below for any architecture docs
relevant to your task.

---

## What this app is

**Bread** (codebase name: `biblemem`) is a Bible memorization app for
iOS, Android, and web. Users add verses, organize them into
collections, then practice by reciting out loud. The app transcribes
the recording (via Soniox), aligns it against the original verse
locally, and scores accuracy. 90% on Hard for 4 consecutive months =
"engraved" mastery.

Live on the [App Store](https://apps.apple.com/app/id6757946016).

## Tech stack

- **Framework**: Expo SDK 54, React Native 0.81, React 19, TypeScript
- **Routing**: Expo Router 6 (file-based)
- **State**: Zustand 5 (in-memory; settings only persisted to AsyncStorage)
- **Backend**: Supabase (Postgres + Auth + Edge Functions in Deno)
- **Storage**: AsyncStorage for settings, in-memory for everything else
- **Audio**: `expo-av` for recording, Soniox API for transcription
- **Animations**: `react-native-reanimated` 4
- **Networking**: Supabase JS client, NetInfo for connection status

Run with `npx expo start` (then scan QR with Expo Go), `npm run ios`,
`npm run android`, or `npm run web`. Lint with `npm run lint`. Type
check with `npx tsc --noEmit`.

## Critical invariants

These rules are load-bearing. Violating them will cause real bugs —
silent data loss, licensing violations, or broken core flows. Keep
them in mind when touching code in the relevant area.

1. **All Supabase writes go through `lib/storage/`, `lib/api/`, or
   `lib/sync/` — never call the supabase client directly from
   components or screens.** Exception: auth calls in
   `lib/auth/context.tsx`. Components must call Zustand actions; the
   store calls storage; storage calls Supabase. This is what keeps
   optimistic updates, RLS, and rollback consistent.

2. **Verse text is NEVER stored in `user_verses`.** The `text` column
   was dropped in migration 005 to comply with ESV/NLT licensing.
   Verse text only lives in `verse_cache` (server, max 500 per
   version, LRU evicted) and the in-memory session cache. If you find
   yourself adding a `text` field to a user-owned table, stop.

3. **All Bible verse reads go through `fetchVerse()` /
   `fetchChapter()` in `lib/api/bible.ts`.** Never read JSON files
   directly from components/screens, never call the edge function
   ad-hoc. The session cache, rate limiting, and KJV bundle
   short-circuit only work if you go through this layer.
   `lib/bible/kjv-bundle.ts` is read **only** from inside
   `fetchVerse`/`fetchChapter` — not directly by any caller.

4. **`chunk.text` is the ground truth for scoring.** Inside a study
   session, scoring compares the transcription against
   `chunks[i].text` (the plain verse), NOT against `displayWords`
   (the masked array shown in the UI). If you change how chunks are
   built, preserve this invariant.

5. **Chunk masks are computed once at session start and frozen.**
   Don't recompute `displayWords` on render — it would re-randomize
   medium-mode blanks every frame. The mask is seeded by chunk ID +
   a session seed (`use-study-session.ts`).

6. **Use `lib/align.ts` for any verse-vs-transcription comparison.**
   Don't roll your own word matching. It handles tokenization,
   punctuation normalization, and produces the alignment shape that
   scoring depends on.

7. **Mastery progression lives in the Zustand store
   (`updateVerseProgress`).** Do not implement streak / engraved
   logic anywhere else. The store is the single source of truth for
   "did this session count toward engraved status."

8. **Theming uses `useColorScheme()` + `Colors[scheme]`, NOT
   `ThemedText`/`ThemedView`.** Despite the names, those abstractions
   are barely used (13 sites vs 200+ raw `<Text>`/`<View>`). The
   actual convention is to call `useColorScheme()` in each component
   and pull tokens from `constants/theme.ts`. Hardcoded hex is only
   acceptable for status colors (error/success/warning) and the
   offline/error-boundary system overlays.

9. **Service role key must never reach the client.** It's used only
   in edge functions. The anon key is what the app ships with, and
   RLS enforces ownership via `auth.uid() = user_id`. Leaking the
   service role key effectively voids all RLS.

10. **The app has no offline write support.** Failed writes are not
    queued. A session attempt logged while offline is silently lost.
    Don't assume a write will eventually succeed — handle errors
    visibly. If you're tempted to add a sync queue, write a feature
    doc first.

11. **Migrations ship to prod *before* the matching client.** Supabase
    migrations apply on push (immediate). The iOS / Android client
    takes days to clear App Store / Play review and even longer to
    propagate to all users. So at any moment the DB schema may be
    ahead of the client by one (or many) migrations, and a non-trivial
    number of users will be on an older client *forever*. **Every
    migration must be safe under "old client + new schema"**:
    - **Additive only.** Never DROP a column, never NOT NULL an
      existing column, never tighten a CHECK on an existing column,
      never rename. Add nullable columns with permissive CHECKs.
    - **Old client SELECTs must keep working.** Supabase JS returns
      all columns; old clients ignore unknown keys (verify your
      mapper doesn't choke). New nullable columns are safe.
    - **Old client INSERTs/UPDATEs must keep working.** Old code
      won't reference new columns — they default to NULL. Make sure
      no NOT NULL or CHECK can be triggered by old write shapes.
    - **New columns must be readable as NULL on the new client.**
      The new client may run against an un-migrated DB during
      rollout (or against an old self-hosted instance). Mappers and
      sort/filter logic must handle missing fields gracefully.
    - **Backfills** are fine but should not block old clients during
      migration. Avoid long-running migrations that take exclusive
      locks on tables old clients are reading.
    - **Cleanup migrations** (DROP a column, tighten NOT NULL) are
      only safe after enough App Store rollout time has passed that
      the oldest live client is post-the-feature. Document the
      rollout window in the feature doc; ship cleanup as a separate
      later migration.

    The same constraint applies to **edge functions** (Bible API,
    transcription) — they deploy from this repo and go live
    immediately. New request/response shapes need backwards-compatible
    handling for old clients still in the wild.

## Code conventions

- **Path alias**: `@/` resolves to project root
  (e.g. `@/components/themed-text`).
- **State**: read with selectors (`useCollections()`,
  `useVersesByCollection(id)`, `useHydrated()`), write with actions
  (`useAppStore.getState().addVerse(...)`).
- **Styles**: `StyleSheet.create()` for static styles at module
  level, inline `style={{}}` only for dynamic theme/state values.
- **Icons**: Use `IconSymbol` from `components/ui/icon-symbol.tsx`.
  Adding a new icon requires editing the `MAPPING` object so Android
  and web can render the Material equivalent of an SF Symbol.
- **Haptics**: Gated to iOS via `if (process.env.EXPO_OS === 'ios')`.
  Use `Haptics.impactAsync(...)` for taps and recording state
  transitions, `Haptics.selectionAsync()` for selection.
- **Don't add comments** unless the *why* is non-obvious. Names should
  carry the *what*. See the global rule against narrating code.
- **TypeScript strict mode** is on. Don't suppress with `as any` —
  fix the type.

## Testing on device

This is a React Native app. **TypeScript and lint do NOT verify that
a feature works.** A green build can ship broken UI, broken gestures,
broken recording, broken sync. If you change anything user-facing,
the human has to test it on a phone or simulator. Don't claim a
feature is done until they have.

## Documentation system

The `docs/` directory is the project's living knowledge base. There
are two tiers:

- **`docs/architecture/` (Tier 2)** — Living docs for each major
  system. These are kept current as code changes. Code is still the
  source of truth on conflict, but these docs explain *why* and
  *how the pieces connect* in ways the code can't.
- **`docs/features/` (Tier 3)** — Feature planning docs. Each has a
  status (`planning` → `building` → `shipped` → `archived`). When a
  feature ships, durable decisions graduate up into the relevant
  Tier 2 doc and the feature doc becomes historical.

To plan a new feature, invoke the `feature-plan` skill — it walks
through doc-first planning with human checkpoints.

## Routing table — read these before touching the relevant area

| Touching... | Read first |
|---|---|
| Bible verse fetching, cache, edge function | `docs/architecture/bible-api-and-caching.md` |
| Adding a Bible version, switching versions | `docs/architecture/bible-versions.md` |
| Study session screen, chunks, scoring, recording | `docs/architecture/study-session.md` |
| Database schema, migrations, RLS | `docs/architecture/data-model.md` |
| Sign-in / sign-up / OAuth / password reset / account delete | `docs/architecture/auth.md` |
| Zustand store, sync, AsyncStorage, offline | `docs/architecture/sync-and-storage.md` |
| Adding a screen, tab, modal, deep link | `docs/architecture/navigation-and-routing.md` |
| Theme tokens, dark mode, fonts, components/ui primitives | `docs/architecture/theming-and-ui.md` |
| Collections, verse-add flow, swipe actions, library list | `docs/architecture/library-and-collections.md` |
| Streaks, time studied, mastered count, popular verses | `docs/architecture/insights-and-streaks.md` |
| VOTM (Verse of the Month), home tab content | `docs/architecture/home-and-votm.md` |
| Soniox transcription, edge function for recording | `docs/architecture/edge-functions.md` |
| Push notifications, cron, prefs UI, device tokens | `docs/architecture/notifications.md` |

If you change how a system works, update the corresponding Tier 2
doc in the same PR. The docs are not optional documentation — they
are the contract the next agent reads.

## Operations / known issues

- `docs/operations/security-todo.md` — Supabase Security Advisor
  warnings to address before public launch (mostly low-risk).

## Known sharp edges

These are real bugs / fragility worth knowing about. Most are
documented in detail in the relevant Tier 2 doc.

- **`get_votm_mastery_count()` SQL function is called by the client
  but not defined in any migration.** Will throw at runtime when a
  user views a VOTM. Fix before depending on the count.
- **Session attempts are silently lost when offline.** No queue, no
  retry, no error toast.
- **KJV is served from a bundled JSON** (`assets/bible/kjv-1769.json`),
  short-circuited inside `fetchVerse` / `fetchChapter`. KJV reads
  bypass the network, the rate limiter, and `verse_cache`. See
  `docs/architecture/bible-api-and-caching.md`.
- **Engraved is now a spaced-repetition milestone, not a calendar
  streak.** Lives in `progress.engraved.{passCount, nextDueAt,
  lifetimeReviews, lastReviewedAt}`; engraved = `passCount >= 10`.
  See `lib/store/review.ts` and `docs/architecture/study-session.md`
  step 8. The legacy `progress.engraved.months` array is preserved
  by migration 014 for the App Store rollout window — old clients
  still write it, the new client read-fallbacks from it but never
  writes it. A follow-up cleanup migration drops it.
- **`popular_ranges` is mastered-only and refreshes every 12h.**
  The cron counts only verses with `progress.hard.completed = true`.
  Soft-deleted-but-mastered verses still count (mastery is
  permanent). A reset on a previously-mastered verse drops its
  contribution on the next cron pass; the table can lag reality by
  up to 12 hours.
