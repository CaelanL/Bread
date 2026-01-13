# State-Management Layer

## Purpose

Central state management using Zustand. Manages global application state including collections, verses, user settings, and authentication state.

## Responsibilities

- Global state store (collections, verses, settings)
- State hydration from storage and server
- State mutations (add/remove/update)
- Loading and error states
- State persistence and recovery
- Settings (color mode, Bible version)

## Source Files to Review

### Core Store
- `lib/store/index.ts` - Main Zustand store (likely large file)

### Store Utilities
- `lib/settings.ts` - Settings utilities
- `lib/cache/session-cache.ts` - Session caching

### Related Hooks
- `hooks/use-count-up.ts` - Count animation hook
- `hooks/use-streak.ts` - Streak calculation
- `hooks/use-study-session.ts` - Study session state logic
- `hooks/use-theme-color.ts` - Theme color selection

## Review Focus

### Scale Issues
- How large can the Zustand store get? (10k+ verses?)
- Does state mutation trigger unnecessary re-renders?
- Are selectors optimized to prevent re-renders?
- Does store hydration take too long on app startup?
- Can the store handle frequent updates (real-time updates)?

### Code Quality
- Is the store well-organized? (too monolithic?)
- Are all state mutations properly typed?
- Are there any `any` types in the store?
- Is error handling comprehensive during mutations?
- Are async operations (fetching, saving) properly handled?
- Is state validation present (invalid states prevented)?

### Future-Proofing
- Can we easily split the store if it gets too large?
- Can we add persistence strategies (e.g., persisting to database)?
- Can we add devtools for debugging?
- Can we add middleware for logging/analytics?
- Can we version the store schema if needed?

### Known Concerns
- Store complexity and size (likely large)
- Selector optimization for performance
- Async mutation handling
- State consistency across app
- Store hydration reliability

## Related Sections

- `BY_LAYER/Storage/` - Persistence layer
- `BY_LAYER/API-Layer/` - Data source
- `BY_DOMAIN/Library-Management/` - Collection state
- `BY_DOMAIN/Study-Session/` - Session state
- `BY_ARCHITECTURE/Data-Flow/` - State flow
- `BY_ARCHITECTURE/Performance/` - Store performance

## Next Steps

Create a `FINDINGS.md` file in your output directory.
