# Feature: Release Automation (EAS Workflows + EAS Update)

> **Status:** `building`
> **Author:** Caelan (research by agent, 2026-08-15, all claims fetched
> from live Expo docs — sources inline)
> **Created:** 2026-08-15
> **Shipped:** —

## Current state

> ⚠️ **Agents: this block is the source of truth for pipeline state,
> and much of that state lives OUTSIDE the repo** (EAS dashboard,
> App Store Connect, interactive CLI). It cannot be reconstructed from
> git. If you change the pipeline, complete a dashboard/CLI step, or
> learn a release shipped, UPDATE THIS BLOCK in the same PR — a stale
> block sends the next agent to exactly the wrong conclusion (it
> already happened once: an agent read the unchecked boxes below and
> concluded the pipeline had never run, days after its first build).

As of **2026-08-16**:

- **Pipeline is LIVE.** GitHub repo linked (EAS dashboard,
  2026-08-15) and ASC API key configured (`eas credentials`,
  2026-08-15) — both interactive steps, no repo artifact.
- **First workflow run: SUCCESS** (2026-08-15, 8 min) — built
  **1.2.0 / build 14** and auto-submitted it. Currently **in App
  Store review**; store users are still on 1.1.1 / build 13.
- **⚠️ The OTA path is INERT for store users until 1.2.0 is
  released.** Build 13 has no expo-updates runtime and can never
  receive an update; build 14 isn't on users' devices yet. A JS-only
  merge today publishes an OTA that only TestFlight installs of
  build 14 receive. Do not assume a merged JS fix has reached users
  until 1.2.0 (or later) is the live store version.
- Remaining: OTA loop verification (JS-only merge → update lands on
  a device), then graduation.

## Problem

Releases are fully manual: merge to main, then (sometimes weeks later)
remember to run `eas build --platform ios --profile production`, then
manually submit in App Store Connect. Result: main sat 10 weeks ahead
of prod (peek/reveal merged 2026-07-09, still unshipped 2026-08-15).
Most of Bread's changes are JS-only session-UX polish that could reach
users in minutes instead of days.

## Solution

Two composable pieces:

1. **EAS Update (OTA)** — JS-only changes ship over the air, no App
   Store review. Users get them on the second cold start after publish.
2. **EAS Workflows** — on push to `main`, a fingerprint check decides:
   native change → full build + submit; JS-only change → publish OTA
   update. One yaml, zero manual steps.

Bread qualifies comfortably for the free tier: 15 iOS builds/mo,
60 CI/CD min/mo, OTA to 1K MAU (we have ~5 users). No overage risk —
free tier hard-stops instead of billing.
[Pricing](https://expo.dev/pricing) ·
[Billing FAQ](https://docs.expo.dev/billing/faq/)

## Requirements

### Must have

- [x] `expo-updates` installed (`~29.0.19`, SDK-54-pinned) +
      `updates.url`/`runtimeVersion` added to app.config.js manually
      (dynamic config — `eas update:configure` can't write it) +
      `channel: "production"` on the production build profile.
      [Getting started](https://docs.expo.dev/eas-update/getting-started/)
- [x] `runtimeVersion` policy set to **`fingerprint`** explicitly (do
      not trust the configure default — docs don't specify it).
      Rationale: appVersion policy breaks if we forget to bump version
      on a native change; fingerprint makes incompatible updates
      "extremely unlikely". [Runtime versions](https://docs.expo.dev/eas-update/runtime-versions.md)
- [ ] **One store release after setup** — OTA capability only exists in
      binaries built with expo-updates. Build 13 can never receive
      updates. This gates everything. *(1.2.0 / build 14 built +
      submitted 2026-08-15 — check this box when it's released.)*
- [x] GitHub repo linked to EAS project — done 2026-08-15 via the EAS
      dashboard (interactive; no repo artifact).
      [Get started](https://docs.expo.dev/eas/workflows/get-started.md)
- [x] App Store Connect API key configured — verified 2026-08-15 via
      `eas credentials --platform ios` (was already set up from earlier
      manual submits; interactive, no repo artifact).
      [Submit iOS](https://docs.expo.dev/submit/ios.md)
- [x] `ascAppId` in eas.json submit profile (6757946016 — confirmed,
      the first workflow submit succeeded against it).
- [x] `.eas/workflows/deploy.yml` using the docs'
      **deploy-to-production** example verbatim as the base:
      fingerprint → existing build with matching hash? → OTA update :
      build + submit. iOS jobs only.
      [Example](https://docs.expo.dev/eas/workflows/examples/deploy-to-production.md)
- [x] Remote version source + autoIncrement in eas.json — was already
      in place (EAS manages buildNumber 11/12/13), as was
      `ascAppId: 6757946016`.
      [App versions](https://docs.expo.dev/build-reference/app-versions/)

### Nice to have

- [ ] Staged rollout for OTA updates (`rollout_percentage` on the
      update job). Overkill at 5 users; note for later.
      [Rollouts](https://docs.expo.dev/eas-update/rollouts.md)

### Explicitly out of scope

- Android release automation (Android isn't shipped today; the docs
  example includes symmetric jobs to add later).
- E2E tests in the workflow.
- Preview/PR channels — production channel only for now.

## Hard rules (from docs, not opinions)

- **Cannot ship OTA:** native code/dependency changes, permission
  changes, Expo SDK upgrades, "anything that requires a new app binary".
  **Can ship OTA:** JS fixes, copy, styling, layouts — and the bundled
  KJV JSON (it's a JS-layer asset).
  [Intro table](https://docs.expo.dev/eas-update/introduction.md)
- **Store policy:** updates must follow App Store guidelines —
  "changes to your app's behavior need to be reviewed." Pattern the
  docs bless: ship the fix OTA, follow up with a store build that
  bakes it in. Our fingerprint workflow does this naturally (next
  native change rebuilds with all JS included).
- **Delivery timing:** `checkAutomatically` defaults to ON_LOAD;
  users typically get the update on the **second** cold start.
  [expo-updates SDK](https://docs.expo.dev/versions/latest/sdk/updates/)
- **Rollback exists:** `eas update:rollback` (to previous update or to
  the build's embedded bundle). [Rollbacks](https://docs.expo.dev/eas-update/rollbacks/)
- Workflows limitations: no shared configs, no matrix builds; yaml
  lives in-repo but runs on EAS infra (GitHub app only delivers
  events). [Limitations](https://docs.expo.dev/eas/workflows/limitations.md)

## Setup order (each step verifiable)

1. `npx expo install expo-updates` → `eas update:configure` → set
   fingerprint policy → verify app.config.js/eas.json diffs match docs.
2. Link GitHub repo in EAS project settings. Verify: dashboard shows
   the repo connected.
3. `eas credentials --platform ios` → ASC API key. Verify:
   `eas submit` works non-interactively on a test.
4. Write `.eas/workflows/deploy.yml` (docs example, iOS jobs only).
5. Ship the gating store build (next version — includes expo-updates
   runtime + whatever's merged). Manual submit OK this one time, or
   let the new workflow do it as its first run.
6. After App Store approval: test the OTA path — trivial JS change to
   main → workflow publishes update → verify on device (two cold
   starts) without a store release.

## Open Questions

- Whether a `build` job inside a workflow consumes a build credit,
  workflow minutes, or both — docs never state it explicitly. At our
  scale it doesn't matter; flagged for accuracy.
- SDK 54: docs are SDK-57-era; no SDK-54-specific caveats found, but
  not positively confirmed. `expo install` pins the compatible
  expo-updates version automatically.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-08-15 | fingerprint runtimeVersion policy | Safest against forgotten version bumps; same hash drives the workflow's build-vs-OTA routing |
| 2026-08-15 | Base the workflow on the docs' deploy-to-production example verbatim | Verified current (July 2026 revision); less to get wrong than hand-rolling |
| 2026-08-15 | iOS only | Android not shipped; example has symmetric jobs to add later |

## Graduation Checklist

- [ ] New Tier 2 doc or section: release pipeline (where the yaml
      lives, how fingerprint routing works, how to rollback)
- [ ] CLAUDE.md: note that merges to main auto-deploy (changes the
      "migrations ship before client" calculus — client JS now ships in
      minutes too, so invariant #11's rollout-window reasoning applies
      mainly to native/store builds)
