# Code Review Instructions

## Overview

This Table of Contents (ToC) is a **single, static reference** that maps the BibleMem application codebase from three complementary perspectives. All code reviews use this ToC as input, then generate independent output directories.

**This document is READ-ONLY after creation. It serves as the authoritative blueprint for all reviews.**

---

## Review Philosophy

This is a **production-ready enterprise code review**, not an MVP assessment. We're evaluating code as if it will run at scale in a major company with millions of users. A boomer senior developer would review this with:

- ✅ Ruthless focus on maintainability and future scalability
- ✅ Zero tolerance for lazy patterns or technical debt
- ✅ Attention to type safety and error handling
- ✅ Consideration of infrastructure and operational concerns
- ✅ Deep thinking about extensibility and change velocity

---

## Review Focus Areas

### 1. **Scale Issues**
- How does the code perform with 10x, 100x, 1000x more users?
- API rate limiting and quota management
- Caching strategies (are they effective? Missing?)
- Database query patterns (N+1 problems? Inefficient joins?)
- State management scalability (Zustand store limits? Memory bloat?)
- Data sync patterns under load

### 2. **Code Quality Issues**
- Type safety (any `any` types? Weak interfaces?)
- Error handling (what happens when things fail?)
- Code organization (is this file doing too much?)
- Testing gaps (critical paths untested?)
- Lazy code (quick hacks that need proper implementation?)
- Anti-patterns (circular dependencies, tight coupling?)

### 3. **Future-Proofing Issues**
- Can we easily add new Bible versions?
- Can we reorder verses/collections without breaking things?
- Can we rename collections/playlists without data migration nightmares?
- Are database schemas extensible?
- Can we add new study modes without rewriting the session logic?
- Is the API contract versionable?

### 4. **Architectural Concerns**
- How does data flow through the system?
- Are auth and business logic properly separated?
- Is the API layer truly a boundary, or does it leak implementation details?
- Can we swap Supabase for another backend without massive refactoring?
- What happens to the app if the backend is down?

---

## The Triple Hierarchy Approach

This ToC provides **three entry points** to review the codebase. A single file may appear in multiple perspectives because we want to catch issues from different angles.

### BY_DOMAIN/ - Feature/Capability Perspective
Start here if you want to review by user-facing features or business capabilities.

**Domains:**
- `Authentication/` - Sign-in, sign-up, password recovery, sessions
- `Library-Management/` - Collections, organizing verses, metadata management
- `Study-Session/` - The core learning loop: difficulty levels, recording, progress
- `Analytics-Insights/` - Streaks, stats, user engagement metrics
- `Settings/` - User preferences, personalization
- `Bible-Data/` - Bible text access, multiple versions, caching
- `Data-Mutations/` - Operations: reorder, rename, reorganize, delete

### BY_LAYER/ - Technical Layer Perspective
Start here if you want to review by architectural layer.

**Layers:**
- `Frontend-Screens/` - Route screens, page components, navigation
- `Components/` - Reusable UI components (buttons, cards, modals, etc.)
- `State-Management/` - Zustand store, global state, data hydration
- `API-Layer/` - Supabase client, API calls, request/response handling
- `Backend-Functions/` - Edge functions, business logic on server
- `Data-Sync/` - Local ↔ Server sync, migrations, conflict resolution
- `Storage/` - AsyncStorage, database schemas, persistence
- `Database-Schema/` - Table structures, migrations, relationships
- `Type-System/` - TypeScript types, interfaces, type safety

### BY_ARCHITECTURE/ - Cross-cutting Concerns
Start here if you want to review systemic issues or non-functional requirements.

**Concerns:**
- `Auth-Flow/` - Authentication architecture, token management, session handling
- `Data-Flow/` - How data moves through the system (user input → storage → display)
- `Caching-Strategy/` - Caching at all levels (API, database, local)
- `Error-Handling/` - Error strategies, fallbacks, user feedback
- `Performance/` - Optimization opportunities, bottlenecks, profiling
- `Extensibility/` - Can we add features without major refactoring?
- `Type-Safety/` - Type coverage, any elimination, interface evolution
- `API-Contracts/` - Endpoint design, versioning, deprecation strategy
- `Dependency-Graph/` - Circular dependencies, coupling, refactoring risks

---

## How Files Appear in Multiple Places

A single source file may be referenced in multiple review branches because different perspectives reveal different issues.

**Example: `lib/store/index.ts` (Zustand store)**

This file appears in:
1. **BY_DOMAIN/Library-Management/** → How does it manage collection state?
2. **BY_DOMAIN/Study-Session/** → How does it track session progress?
3. **BY_LAYER/State-Management/** → Is the store architecture scalable? Typed correctly?
4. **BY_ARCHITECTURE/Data-Flow/** → Where does data originate? How does it propagate?
5. **BY_ARCHITECTURE/Performance/** → Could the store be a memory bottleneck?
6. **BY_ARCHITECTURE/Type-Safety/** → Are all actions properly typed?

Each review branch looks at the same code but asks different questions.

---

## Status Scheme

Each item in a review output directory has a status. When an agent resumes work, they check their output directory for status markers to continue where they left off.

### Status Values

- **`not_started`** - Not yet reviewed
- **`in_review`** - Currently being reviewed (work in progress)
- **`review_done_needs_followup`** - Initial review complete, but issues identified that need follow-up or tickets created
- **`review_done_followup_done`** - Review complete AND all follow-up actions taken

### How to Mark Status

In your output directory, mark status at the top of each section file:

```markdown
[STATUS: in_review]

## Section: Authentication Flow

### Findings
- ...
```

When resuming: Check your output directory, find sections marked `in_review` or `review_done_needs_followup`, and continue from there.

---

## Critical Rule: Prevent Reviewer Bias

**🚨 AGENTS: DO NOT READ EXISTING OUTPUT DIRECTORIES 🚨**

This is crucial for unbiased reviews. Each agent should:

1. Read ONLY the ToC (this directory)
2. Create their own fresh output directory: `code-review-output-[agent-name]/`
3. Mirror the ToC structure in their output directory
4. Add their own findings, status markers, and follow-ups
5. **NEVER** read other agents' output directories
6. **NEVER** read other agents' findings before conducting their own review

### Why This Matters

If you read another agent's findings first, you'll be anchored to their perspective and miss issues they missed. We want **independent, fresh perspectives** from each reviewer.

---

## How to Create Your Output Directory

When you start a review:

1. Create a new directory: `code-review-output-[your-identifier]/`
   - Example: `code-review-output-rovodev1/`, `code-review-output-claude-sonnet/`

2. Mirror the ToC structure exactly:
   ```
   code-review-output-[your-name]/
   ├── BY_DOMAIN/
   │   ├── Authentication/
   │   ├── Library-Management/
   │   └── ... (all domains from ToC)
   ├── BY_LAYER/
   │   └── ... (all layers from ToC)
   └── BY_ARCHITECTURE/
       └── ... (all architectures from ToC)
   ```

3. For each section in the ToC, create a corresponding file in your output:
   - Example: `code-review-output-rovodev1/BY_DOMAIN/Authentication/FINDINGS.md`

4. In each findings file, include:
   - Status marker at top: `[STATUS: not_started]` → `[STATUS: in_review]` → etc.
   - Your review findings, issues, concerns
   - References to specific source files and line numbers
   - Severity levels (if relevant): Critical, High, Medium, Low
   - Suggested improvements or tickets to create

5. When you resume: Read your output directory's status markers to pick up where you left off

---

## Navigation Tips for LLMs

### Finding Code for a Section
Each section in the ToC (e.g., `BY_DOMAIN/Authentication/_SECTION.md`) contains:
- Description of what this section covers
- List of source files included
- Key files to review first
- Known concerns to watch for

### Understanding Dependencies
Check `BY_ARCHITECTURE/Dependency-Graph/` to understand:
- Which files depend on which
- Circular dependency risks
- Refactoring impact zones

### Tracing Data Flow
Check `BY_ARCHITECTURE/Data-Flow/` to see:
- Where user input enters the system
- How data is transformed
- Where it's stored
- How it's displayed back to users

### Understanding Performance Impact
Check `BY_ARCHITECTURE/Performance/` to see:
- Known bottlenecks
- Caching opportunities
- API quota concerns

---

## Review Output Example

When you complete a review section, your output might look like:

```markdown
[STATUS: review_done_needs_followup]

## Section: BY_DOMAIN/Authentication

### Summary
The authentication flow is mostly solid but has type safety issues and potential race conditions.

### Critical Issues
1. **Type-unsafe token handling** (HIGH PRIORITY)
   - File: `lib/auth/context.tsx`, lines 45-62
   - Issue: Token stored as `any`, should be typed
   - Impact: Could cause runtime errors in production
   - Suggested fix: Create `type AuthToken = { accessToken: string; refreshToken: string; }`

2. **Race condition on logout** (MEDIUM PRIORITY)
   - File: `lib/auth/index.ts`, line 89
   - Issue: Multiple logout calls could create race conditions
   - Impact: Token might not be properly cleared
   - Suggested fix: Add mutex lock or use AbortController

### Code Quality Issues
- Missing error boundaries in sign-in screen
- No retry logic for auth failures

### Future-Proofing Issues
- Hard-coded token refresh time (30min) makes it hard to change policy
- No support for multiple sessions/devices

### Tickets Created
- [ ] TICKET-123: Type the authentication token
- [ ] TICKET-124: Add mutex lock to logout
- [ ] TICKET-125: Make token refresh time configurable

### Next Review Section
Continue with `BY_DOMAIN/Library-Management/`
```

---

## Workflow Summary

```
1. Agent reads: code-review-toc/ (this directory)
2. Agent creates: code-review-output-[agent-name]/
3. Agent mirrors structure from ToC into their output directory
4. Agent reviews each section, marks status as they go
5. Agent adds findings, issues, severity levels
6. Agent creates tickets/follow-ups as needed
7. Agent marks section complete: [STATUS: review_done_followup_done]
8. Next agent reads ONLY the ToC, creates THEIR OWN output directory
9. Multiple agents work in parallel without seeing each other's work
10. Later, findings from all output directories can be aggregated (but don't cross-contaminate during review)
```

---

## Questions?

Refer to the specific section files (`_SECTION.md`) in each directory for detailed guidance on that area of the codebase.
