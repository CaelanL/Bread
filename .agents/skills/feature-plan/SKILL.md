---
name: feature-plan
description: "Doc-first feature planning and build workflow with human checkpoints. Guides through: plan → build → review → sweep → ship."
argument-hint: "[feature description]"
---

# Feature Build Process

You are guiding a multi-phase feature workflow. This is NOT a one-shot
plan — it has explicit pause points where you surface decisions for
the human and WAIT for their input before proceeding.

The user invoked this with: $ARGUMENTS

---

## Phase 1: Draft the doc

1. Read the relevant Tier 2 architecture docs in `docs/architecture/`
   (start with `data-model.md`, then any others touching the surface
   you're changing — e.g. `study-session.md` if touching the study
   loop, `bible-api-and-caching.md` if touching verse fetching).
   Also read AGENTS.md for the load-bearing invariants.
2. Skim other docs in `docs/features/` for similar prior features.
3. Create a feature doc at `docs/features/[slug].md` using
   `docs/features/_TEMPLATE.md` as the structure.
4. The doc MUST include a non-empty **Open Questions** section.
   Surface every decision where:
   - There are multiple valid UX/UI approaches
   - Product scope is ambiguous ("must-have or nice-to-have?")
   - Data model has tradeoffs (denormalize vs join, soft vs hard delete)
   - Business rules need human judgment
   - Edge cases have product implications
5. Present each open question with **options and tradeoffs**, not just
   the question. Do NOT pick an answer — wait for the human.
6. **Technical depth bar.** The Technical Approach section should be
   detailed enough that someone unfamiliar with the codebase could
   build the feature correctly on the first try. Specifically:

   - **Schema specificity**: every column has type, default,
     nullability, CHECK constraints, and a 1-line note on what it's
     for
   - **Indexes called out with the queries they support** — not "add
     indexes," but "`idx_X_user_id` on `(user_id, created_at DESC)` —
     supports the insights query in `lib/api/analytics.ts`"
   - **RLS policies written out in full SQL** with a 1-line security
     reasoning inline
   - **Migrations** — one new file in `supabase/migrations/`, numbered
     after the highest existing one. Spell out the SQL.
   - **Triggers and functions spelled out** with edge cases handled
     (concurrency, NULL, idempotency)
   - **Atomicity**: any multi-table operation should say whether it
     needs a Postgres function / transaction and why
   - **Sync impact**: does this touch tables that sync between local
     Zustand and Supabase? If yes, how does sync handle the new
     fields/tables?
   - **Cache impact**: does this affect the Bible cache layers
     (session cache, DB cache)? Cache key changes? Invalidation?
   - **Tradeoffs acknowledged with the migration path** ("accept this
     cost at current scale; if it gets slow, add denormalized X")
   - Vague bullets where concrete SQL / TypeScript would be clearer
     are not acceptable.

   If your data model section is just a high-level sketch, it's not
   done yet.
7. **STOP and tell the human the doc is ready for first review.**

## Phase 2: Human review #1

The human reads the doc and answers open questions. They may:
- Resolve questions and log decisions
- Add requirements or edge cases you missed
- Challenge scope labels
- Ask you to restructure sections

Apply their feedback. **STOP and confirm changes before next step.**

## Phase 3: Agent review of the doc

Launch a review agent (general-purpose subagent) to audit the doc.
Brief it carefully — it should challenge the doc, not just validate
it. The bar is: "would this doc let someone unfamiliar with the
codebase build the feature correctly on the first try?"

The agent should check for:

**Product & scope gaps:**
- Missed edge cases
- Conflicts with existing architecture docs
- Scope labels mislabeled ("nice to have" that's actually data
  integrity, "not in scope" that's actually required)
- Missing open questions — decisions resolved that shouldn't have
  been resolved without human input
- Dependency issues (does this block or get blocked by other features?)
- Missing "What does NOT change" section

**Technical depth gaps — these are the most common failures:**
- Schema tables missing types/defaults/nullability/CHECK constraints
- Indexes listed without the query they support
- RLS described in prose instead of full SQL
- RLS policies missing security reasoning inline
- Triggers/functions mentioned but not spelled out, or spelled out
  without edge case handling
- Atomicity concerns not called out for multi-table writes
- Sync impact ignored when relevant (Zustand ↔ Supabase)
- Bible cache impact ignored when relevant
- Tradeoffs stated without migration path
- Vague bullets where concrete SQL/TypeScript would be clearer

**Build order gaps:**
- Steps that are actually two steps jammed together
- Missing dependencies between steps
- No mention of what runs atomically in a single migration
- Missing "what does NOT change" side of Files Changed

For each finding, give file path/section, exact quote from the doc,
and what's wrong. Don't report style preferences — report gaps that
would cause bugs at build time.

**STOP and present the review findings to the human.**

## Phase 4: Human review #2

The human reads the agent's review and decides:
- Which findings are valid → update the doc
- Which findings are false positives → ignore
- Whether any findings trigger new open questions → resolve them

Apply changes. **STOP and ask the human if they want another agent
review (Phase 3 again) or if the doc is ready to build.**

## Phase 5: Optional second agent review

If the doc changed significantly in Phase 4, offer to run another
review. Skip if the human says the doc is ready.

## Phase 6: Build

Only start this after the human approves the final doc.

1. Create a task list from the doc's build order.
2. Build sequentially, marking tasks complete as you go.
3. Run `npx tsc --noEmit` after TypeScript changes.
4. Run `npm run lint` before declaring a phase complete.
5. If migrations were added, apply them locally:
   `supabase db push` or `supabase migration up`.
6. If you discover something the doc didn't anticipate, STOP and
   surface it as a mid-build decision. Don't assume.

## Phase 7: Code review

1. Launch a review agent (background) to audit all changed files.
2. When it returns, filter findings into valid issues vs false
   positives.
3. Fix real issues. Explain what you kept and what you discarded.

## Phase 8: Product review

**STOP and ask the human to review.** Prompt them:
- "Here's what I built and what to check on a real device."
- "Are there flows that should be constrained but aren't?"
- "Does the settings page still make sense?"

Note: this is a React Native app — the human needs to test on an
actual phone or simulator, not in a browser. Don't claim it works
unless they've used it.

If the human identifies gaps, fix them. If scope expands, ask:
"Should this be in this PR, deferred, or a new feature?"

## Phase 9: Deep sweep

Launch a thorough exploration agent to verify completeness:
- Runtime type mismatches (TypeScript catches some, not all — check
  Zod schemas, Supabase response shapes)
- Old conventions still in use
- Missing cascade/validation on deletes
- Stale data flow (Zustand store not updated after a write)
- SQL/PostgREST references
- Sync logic for new tables/fields
- Bible cache invalidation if cache keys changed
- Scripts and test files

## Phase 10: Docs & handoff

1. Update the feature doc status to `shipped` with a "What Was Built"
   section.
2. **Graduation**: extract durable decisions into the relevant Tier 2
   docs (`docs/architecture/data-model.md`, `study-session.md`, etc.).
   The feature doc is historical context after this; the Tier 2 docs
   are the living source of truth.
3. Update AGENTS.md routing table if you added a new architecture doc.
4. Save relevant memories.
5. Write a handoff block for the next conversation.
6. **Present the handoff to the human for review.**
