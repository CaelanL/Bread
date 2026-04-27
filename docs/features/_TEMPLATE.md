# Feature: [Feature Name]

> **Status:** `planning` | `building` | `shipped` | `archived`
> **Author:** [name]
> **Created:** [YYYY-MM-DD]
> **Shipped:** [YYYY-MM-DD, when shipped]

## Problem

What user / product / engineering problem does this feature solve?
One or two paragraphs. Be concrete — "users can't see X" beats "we
need better Y."

## Solution

The shape of the solution at a high level. Doesn't need to be
detailed yet — that's the Technical Approach. This is the
elevator-pitch description of what will exist after the feature
ships.

## Requirements

### Must have

- [ ] …
- [ ] …

### Nice to have

- [ ] …

### Explicitly out of scope

- …

## Open Questions

For each: state the question, list the options with tradeoffs,
**don't pick one yet** — wait for the human.

### Q1: [Short title]

[The question, with enough context to answer.]

- **Option A**: … *(tradeoffs)*
- **Option B**: … *(tradeoffs)*

### Q2: …

## Technical Approach

The bar: someone unfamiliar with the codebase should be able to
build this correctly on the first try. Be concrete with SQL,
TypeScript, file paths. Vague bullets where SQL would be clearer
are not done.

### Data model changes

If any new tables, columns, indexes, RLS policies, triggers, or
functions: spell them out in full SQL in a new migration file
(`supabase/migrations/NNN_<name>.sql`).

For each new table:

| Column | Type | Default | Nullable | CHECK | Notes |
|---|---|---|---|---|---|

For each new index, name the queries it supports.

For each new RLS policy, write the full SQL with security
reasoning inline.

If the change affects sync (`lib/sync/`, Zustand store), say so
explicitly. If it affects the Bible cache (cache key, version
dimension), say so explicitly.

### API / edge function changes

If a new edge function or new route: spell out the request/response
shape and which `_shared/` utilities it uses.

### Client changes

- **Files added**: `…`
- **Files modified**: `…`
- **Files removed**: `…`

For each, what changes and why.

### State changes

What new Zustand slice, action, or selector? What's persisted, what's
ephemeral?

### UI

Describe the screens, components, and gestures. Reference primitives
in `components/ui/` where possible. Note any new icons (need a
mapping entry in `icon-symbol.tsx`).

### Edge cases

- Offline behavior?
- Empty/error/loading states for every async surface?
- What happens at the data-model boundaries (deleted parent,
  concurrent writes, missing optional field)?

### What does NOT change

Important — call out the parts of the system this feature
deliberately leaves alone. Helps reviewers focus.

## Build order

A sequential list of PR-sized chunks. Each chunk should leave the
app in a working state. Number them.

1. …
2. …
3. …

For each, list the files changed and the migration (if any).

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|

## Graduation Checklist

When status moves to `shipped`, extract durable decisions UP into
the relevant Tier 2 architecture doc(s) and check off below:

- [ ] Schema changes reflected in `docs/architecture/data-model.md`
- [ ] New API or cache behavior reflected in `docs/architecture/bible-api-and-caching.md`
- [ ] New version added to `docs/architecture/bible-versions.md` (if relevant)
- [ ] Session-loop changes reflected in `docs/architecture/study-session.md`
- [ ] Sync/storage changes reflected in `docs/architecture/sync-and-storage.md`
- [ ] Auth changes reflected in `docs/architecture/auth.md`
- [ ] Routing changes reflected in `docs/architecture/navigation-and-routing.md`
- [ ] UI primitives changes reflected in `docs/architecture/theming-and-ui.md`
- [ ] Library/collection changes reflected in `docs/architecture/library-and-collections.md`
- [ ] Insights changes reflected in `docs/architecture/insights-and-streaks.md`
- [ ] Home/VOTM changes reflected in `docs/architecture/home-and-votm.md`
- [ ] Edge function changes reflected in `docs/architecture/edge-functions.md`
- [ ] CLAUDE.md routing table updated (if a new architecture doc was added)
- [ ] CLAUDE.md invariants updated (if a new load-bearing rule emerged)

## What Was Built

(Filled in when shipped — short summary of what actually shipped vs
what was planned, and any deferred items.)
