# Release

How a change gets from a branch to phones. Three things reach prod, on three clocks: migrations and edge functions go live as soon as `npm run release` applies them, JavaScript reaches installed apps over the air, and native changes wait for App Store review. Migration rules for that gap: `docs/architecture/data-model.md`.

## `npm run release`

`scripts/release.mjs` is the only path to prod. `.claude/settings.json` and `.codex/rules/release.rules` block `gh pr merge`, pushing to `main` and `supabase db push` for agents. Any failing step stops the rest and says what to do. It is safe to rerun.

| Step | What it does |
|---|---|
| 1 | Merges `origin/main` into the branch |
| 2 | `npm run check` |
| 3 | `scripts/check-migrations.mjs --strict`: a destructive migration needs its `-- destructive-ok:` line |
| 4 | Re-dates new migration files older than prod's newest, rebuilds locally if it did, pushes the branch |
| 5 | Waits for CI (`.github/workflows/ci.yml`), applies migrations to prod, deploys changed edge functions |
| 6 | Squash-merges the PR, deletes the remote branch |
| 7 | Waits for the EAS workflow run on the merge commit (`confirmEas`) and reports it |

- A change to `supabase/functions/_shared/` redeploys every function (`changedFunctions`).
- `--dry-run` runs steps 1-4, which do commit and push, then step 5 as `db push --dry-run`, then stops.
- On `main`, it runs steps 1, 2, 3 and 5 only, to catch prod up. It deploys no functions there: it stops and lists any with commits newer than their deployed version (`checkFunctionsCatchUp`).
- A lock in the git common dir lets one release run at a time across worktrees.
- Settings live in `kit` in `package.json`: `prodProjectRef`, `deployFunctions`, `deploy`, `restoredMigrations`.
- Prod access uses `SUPABASE_ACCESS_TOKEN`, from the environment or from `.envrc` through direnv.

## The deploy workflow

`.eas/workflows/deploy.yml` runs on EAS on every push to `main`. It is the Expo docs' deploy-to-production example, iOS jobs only.

- A `fingerprint` job hashes the native project.
- `get_ios_build` looks for a production build with that hash.
- A match means the change is JS-only: `publish_ios_update` publishes an OTA update to the `production` branch.
- No match means a native change: `build_ios` builds, and `submit_ios_build` submits to App Store Connect.

**The workflow is paused.** The `build_ios`, `submit_ios_build` and `publish_ios_update` jobs are removed from the file, so a merge ships no build and no OTA update, and step 7 still prints "Deploy live". To end the pause, on the branch of the release that should ship:

```
git restore --source=7787992 -- .eas/workflows/deploy.yml
```

Don't use `git revert`: the release squash-merges, so that would undo the whole commit that paused it. Edit this section when the jobs return.

## What can ship over the air

- `runtimeVersion` uses the `fingerprint` policy (`app.config.js`), so an update only reaches binaries with the same native hash.
- OTA can carry JS fixes, copy, styling, layouts and JS-layer assets such as the bundled KJV JSON.
- OTA can't carry native code or dependency changes, permission changes, or Expo SDK upgrades. Those need a new binary.
- Store policy still applies. Changes to the app's behavior need review, and the next native build bakes in all merged JS.
- `checkAutomatically` stays at its default, `ON_LOAD`, so users typically get an update on the second cold start.
- Roll back with `eas update:rollback`, to the previous update or to the build's embedded bundle.
- A binary built before `expo-updates` was added can never receive an update.

## Versions

- `eas.json` has `appVersionSource: "remote"` and `autoIncrement` on the `production` profile, so EAS owns the build number. `ios.buildNumber` in `app.config.js` is ignored.
- `version` in `app.config.js` is the marketing version, and it changes the fingerprint, so bumping it routes that merge to a build.
- App Store Connect rejects an upload whose marketing version's train is closed, and the build number is used up anyway. Bump `version` before any native change that follows an approved release.
- `eas.json` profiles: `development`, `simulator` (`npm run sim -- install`), `preview`, `production` (channel `production`).

## What lives outside the repo

These were interactive steps with no repo artifact, so git can't show them:

- The GitHub repo is linked to the EAS project in the EAS dashboard. The GitHub app only delivers events; workflows run on EAS.
- The App Store Connect API key is configured through `eas credentials --platform ios`. `ascAppId` is in `eas.json`.

Which build and version is live on the App Store is in App Store Connect, not here.

Invite links depend on sendlabs.dev (repo `sendlabs-portfolio`, Vercel): it must serve
`/.well-known/apple-app-site-association` and `/bread/join/[code]` before an app version whose
invite message links there reaches anyone, OTA included. See
[navigation-and-routing.md](navigation-and-routing.md#deep-links).

## Limits

- iOS only. Android isn't shipped, and the Expo example has matching jobs to add when it is.
- Production channel only: no preview or PR channels, no staged OTA rollout.
- No end-to-end tests in the workflow.
- EAS workflows have no shared configs and no matrix builds.

## Decisions

- 2026-08-15 · `fingerprint` runtime version policy · Safest against a forgotten version bump, and the same hash drives the build-or-OTA routing.
- 2026-08-15 · Base the workflow on the Expo deploy-to-production example, not a hand-rolled one · Less to get wrong.
- 2026-08-15 · iOS only · Android isn't shipped.
