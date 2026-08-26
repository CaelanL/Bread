# Feature: Remember Study Prefs (chunk size + difficulty)

> **Status:** `shipped`
> **Author:** Caelan (built with Claude)
> **Created:** 2026-08-25
> **Shipped:** 2026-08-25

## Problem

The study setup screen forgot the chunk size and difficulty every
time. Every session on a long passage meant re-picking "verses per
chunk". The only memory was a hardcoded mastered-verse default (hard +
whole passage in one chunk), which was a workaround, not a preference.

## Decision

Persist the last-chosen chunk size and difficulty **per verse row** in
`user_verses` (`last_chunk_size INT`, `last_difficulty TEXT`, both
nullable — migration 021). Saved whenever the user changes the setup
(difficulty tap, chunk picker, All button) and again on **Start
session**; restored (clamped to the passage's verse count) when the
setup screen next opens. The saved preference always wins. The old mastered-verse
default (hard + whole passage) survives only as the fallback for a
mastered verse with NULL prefs — every pre-021 mastery — because
engraved reviews only qualify on Hard, and defaulting those to easy
would silently stall spaced repetition (caught in code review).
Everything else falls back to easy / 1-verse chunks.

Key calls (details graduated to `docs/architecture/data-model.md`,
`user_verses` → "Study prefs"):

- **Columns, not `progress` JSONB keys** — progress round-trips
  through `parseProgress` (strips unknown keys) and whole-object
  writes, so old clients would clobber a JSONB key. Separate nullable
  columns are invisible to old clients and survive Reset Progress.
- **Shared across collections** — one `user_verses` row per
  reference, so the pref follows the verse everywhere. Accepted.
- **Fire-and-forget write** — it's a preference; a lost write (e.g.
  offline) just means defaults next time. No error surfacing, no
  rollback.

## Rollout safety

Additive-only migration; old clients never reference the columns
(reads use `select(*)` + defensive mappers, writes never include
them). New client tolerates NULL / missing columns via `typeof`
guards, so it also works against an un-migrated DB.
