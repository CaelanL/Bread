# Bread
Bread (codebase and folder name `biblemem`, GitHub `CaelanL/Bread`) is a Bible memorization app, live on the [App Store](https://apps.apple.com/app/id6757946016). Users add verses, organize them into collections, then recite out loud. The app transcribes the recording with Soniox, aligns it against the verse on the device, and scores it. 90% completes a difficulty, Hard means mastered, and 10 passed spaced reviews means engraved. Say "Bread" in anything a user reads.

## Map
- Stack: Expo SDK 54, React Native 0.81, React 19, TypeScript strict, Expo Router 6, Zustand 5, `react-native-reanimated` 4, Supabase (Postgres, Auth, Edge Functions in Deno). iOS is what ships. Android and web run but aren't released.
- `app/` — screens and routes. `components/` — UI, grouped by area, `ui/` holds shared primitives. `hooks/` — `use-study-session.ts`, `use-recording.ts` and others. `constants/theme.ts` — tokens.
- `lib/` — `store/` (Zustand, mastery), `api/` (Bible, recording, stats), `storage/`, `sync/`, `auth/`, `notifications/`, `transcription/`, `bible/`, plus `align.ts` and `study-chunks.ts`. Co-locate new code with its feature. A new file here must start with `// lib-ok: <reason>`.
- `supabase/` — `migrations/`, `functions/` (`bible`, `process-recording`, `transcription-token`, `send-notifications`), `tests/` (pgTAP), `seed.sql`, `database.types.ts` (generated). `scripts/` — kit tools. `.eas/workflows/` — deploy.
- Old code comments and migrations cite `CLAUDE.md` invariants, which are the numbered list below, and `docs/features/<change>.md` files that no longer exist. Look in the area doc or git history instead.

**Docs: read the matching one before touching that area.**

| Touching | Read |
|---|---|
| Setup screen, chunks, masks, peek, scoring | `docs/features/study-session.md` |
| Recording, Soniox, batch and live paths | `docs/features/transcription.md` |
| Mastery, spaced repetition, engraved | `docs/features/review.md` |
| Collections, add-verse flow, sorting, library list | `docs/features/library.md` |
| Streak, time studied, popular ranges | `docs/features/insights.md` |
| Home tab, Verse of the Month | `docs/features/home.md` |
| Push, cron, prefs UI, device tokens | `docs/features/notifications.md` |
| Verse fetching, caches, KJV bundle | `docs/architecture/bible-api-and-caching.md` |
| Adding or switching a Bible version | `docs/architecture/bible-versions.md` |
| Schema, migrations, RLS | `docs/architecture/data-model.md` |
| Edge functions, secrets | `docs/architecture/edge-functions.md` |
| Sign-in, sign-up, password reset, account delete | `docs/architecture/auth.md` |
| Store, hydration, what's persisted, offline | `docs/architecture/sync-and-storage.md` |
| Screens, tabs, modals, deep links | `docs/architecture/navigation-and-routing.md` |
| Tokens, dark mode, fonts, `components/ui` | `docs/architecture/theming-and-ui.md` |
| Release, EAS, OTA | `docs/architecture/release.md` |

## Run and check
- `npm start` — the app against the local DB; it refuses to start on a non-local database. `npm run ios`, `npm run android`, `npm run web`.
- `npm run db:start`, `db:stop`, `db:reset`, `db:status`, `db:env`, `db:types`, `db:destroy` — the local Supabase for this folder. `npm run test:db` — database tests alone.
- `npm run check` before calling anything done; `npm run check:fast` while iterating. `npm test` — unit tests alone.
- `npm run doctor` when the local setup breaks.
- `npm run sim -- shot <route> [--as <seed user>]` — screenshots of the local app in the simulator, to `.expo/sim-shots/`. Each area doc's "Browser checks" list runs this way, since Bread has no browser flows.
- `npm run sim -- flow <name|all>` — runs the Maestro flows in `.maestro/` (taps, typing, iOS permission prompts) against the local DB. Prints pass or fail and the screenshots, under `.expo/sim-shots/flows/`. Flows change local data, and `npm run db:reset` restores the seed. Needs Maestro (`curl -fsSL "https://get.maestro.mobile.dev" | bash`).
- Local seed users are described at the top of `supabase/seed.sql`. They exist only on local databases.
- Supabase CLI: run `direnv exec . supabase <cmd>` from agent shells, so it gets `SUPABASE_ACCESS_TOKEN` from `.envrc`. Never run `supabase login`. Never print or commit `.envrc`.

## Rules
- Prod changes only through `npm run release`. Merge only with `npm run release`, never on the GitHub website.
- Nobody changes prod by hand. Every database change is a migration file.
- A migration that destroys data needs `-- destructive-ok: <what>, approved by <name> <date>`.
- This repo is public. No secrets, logins, real user data or account details in tracked files.
- Living docs: no status lines; edit in place, no dated sections; each fact in one doc, others link to it; decisions in "## Decisions" at the bottom of the doc they're about; cite files and symbols, not line numbers; update the docs in the same PR as the code.
- TypeScript and lint don't prove a feature works. A change to anything user-facing needs a look on the simulator with `npm run sim` (`shot` to look, `flow` to tap through), and recording or push need a person on a real device. Say which was done.
- Agents never use computer use (Mac screenshots, clicks) to test Bread. Simulator checks go through `npm run sim -- flow`; a missing tap path gets a new flow in `.maestro/`.

**Invariants.** Breaking these causes silent data loss, licensing violations or broken core flows.
1. All Supabase writes live in `lib/`, never in components or screens. Exception: auth calls in `lib/auth/context.tsx`. See `docs/architecture/sync-and-storage.md`.
2. Verse text is never stored in `user_verses` or any user-owned table (ESV and NLT licensing). See `docs/architecture/bible-api-and-caching.md`.
3. All Bible reads go through `fetchVerse()` and `fetchChapter()` in `lib/api/bible.ts`. `lib/bible/kjv-bundle.ts` is read only from inside them. See `docs/architecture/bible-api-and-caching.md`.
4. `chunk.text` is the ground truth for scoring, not `displayWords`. See `docs/features/study-session.md`.
5. Chunk masks are computed once at session start and frozen. See `docs/features/study-session.md`.
6. Use `lib/align.ts` for any verse-versus-transcription comparison. See `docs/features/study-session.md`.
7. Mastery progression lives in the store's `updateVerseProgress`. Nothing else implements engraved logic. See `docs/features/review.md`.
8. Theming uses `useColorScheme()` and `Colors[scheme]`, not `ThemedText` or `ThemedView`. Hardcoded hex only for status colors and system overlays. See `docs/architecture/theming-and-ui.md`.
9. The service role key never reaches the client. It's used only in edge functions. See `docs/architecture/edge-functions.md`.
10. The app has no offline write support. Failed writes aren't queued, so handle errors visibly. See `docs/architecture/sync-and-storage.md`.
11. Migrations reach prod before the matching client, and old clients stay in the wild, so every migration must be safe under "old client + new schema": additive only, nullable, permissive CHECKs. Edge function changes go live at once and must stay backward-compatible. See `docs/architecture/data-model.md`.
12. All transcription goes through the `processRecording` seam in `hooks/use-study-session.ts`, and all live-streaming I/O lives in `lib/transcription/live-session.ts`. The live path fails silently into batch and never loses a recording. See `docs/features/transcription.md`.

**Code conventions**
- `@/` resolves to the project root.
- State: read with selectors (`useCollections()`, `useVersesByCollection(id)`, `useHydrated()`), write with actions (`useAppStore.getState().addVerse(...)`).
- Styles: `StyleSheet.create()` at module level, inline `style={{}}` only for dynamic theme or state values. Lint rejects radii, durations and press scales outside `constants/theme.ts`.
- Icons: `IconSymbol` from `components/ui/icon-symbol.tsx`. A new icon needs a `MAPPING` entry for Android and web.
- Haptics are gated to iOS with `process.env.EXPO_OS === 'ios'`.
- No comments unless the why is non-obvious. No `as any`: fix the type.

## App-wide decisions
- The scoring formula is final: `(correct + 0.5*close) / (correct + close + missing + added)`. Added words stay in the denominator on purpose. Fix fairness in alignment normalization, never in the formula. See `docs/features/study-session.md`.
- Only public-domain translations are bundled in the app. Licensed text is fetched, and held only in the server cache and in memory. See `docs/architecture/bible-api-and-caching.md`.
- Don't gate work on "wait for production data". Bread is small, so ship reasonable-default constants and name the knob to turn if scale ever matters.
- Merges ship through EAS: JS over the air, native changes through the App Store. Those jobs are paused in `.eas/workflows/deploy.yml` for now. See `docs/architecture/release.md`.

## Review checklist
- A migration is safe under old client + new schema (invariant 11), and a new table has access-rule tests in `supabase/tests/`.
- A new function is revoked from clients unless they need it, and `supabase/tests/catalog.test.sql` agrees.
- An edge function change still answers old clients.
- A store write goes to Supabase and has a rollback or a visible error, and the screens that read that state show it after a save.
- Nothing logs or stores verse text outside the allowed caches.
- A new Bible read, score or engraved rule uses the one existing path, not a parallel one.
- A file added to `lib/` earns its `// lib-ok:` line.
