[STATUS: review_done_needs_followup]

# BY_LAYER/State-Management Code Review

## Summary
State management uses a single Zustand store at `lib/store/index.ts` (886 lines). It manages collections, verses, mastered verses, and settings. The architecture is well-designed with proper selectors using `useShallow` and `useMemo` for performance. However, the store is monolithic and has some concerning patterns around async mutations and error handling.

---

## Critical Issues

### 1. Store Mutations Wait for Server Before Local Update (HIGH)
**File:** `lib/store/index.ts:434-584` (addVerse), `lib/store/index.ts:586-658` (deleteVerse)
**Issue:** Unlike `addCollection` which optimistically updates, `addVerse` and `deleteVerse` wait for server, then do a full refetch:

```typescript
// addVerse - line 577-581
await Promise.all([
  get().fetchVerses(),      // Full refetch instead of local update
  get().fetchMasteredVerses(),
]);
```

**Impact:**
- 200-500ms latency per operation
- Two full API calls after every add/delete
- Poor UX for rapid operations

**Suggested Fix:** Optimistically update local state, then reconcile with server in background.

### 2. No Pagination in Fetch Methods (HIGH)
**Files:** `lib/store/index.ts:185-227` (fetchVerses), `lib/store/index.ts:229-265` (fetchMasteredVerses)
**Issue:** All data fetched at once:

```typescript
const { data, error } = await supabase
  .from('verse_collections')
  .select(`...`)
  // No .limit() or .range()
```

**Impact at Scale:** User with 10,000 verses = 10,000+ rows in memory, slow hydration.

### 3. Hydration Never Completes on Partial Failure (MEDIUM-HIGH)
**File:** `lib/store/index.ts:289-297`
**Issue:** All three fetches must succeed for hydration:

```typescript
const [collectionsOk, versesOk, masteredOk] = await Promise.all([...]);
if (collectionsOk && versesOk && masteredOk) {
  set({ hydrated: true, error: null });
}
// If ANY fails, hydrated stays false forever!
```

**Impact:** If mastered verses fails but collections/verses succeed, user sees loading forever.

**Suggested Fix:** Hydrate partially with available data, show errors per section.

### 4. Race Condition in Collection Delete (MEDIUM-HIGH)
**File:** `lib/store/index.ts:368-430`
**Issue:** Multi-step operation without transaction:
1. Fetch collection ID
2. Fetch default collection ID
3. Soft-delete collection
4. Move verses
5. Update local state

If step 4 fails, collection is deleted but verses are orphaned.

---

## Code Quality Issues

### 5. Duplicate DEFAULT_PROGRESS Definitions (MEDIUM)
**File:** `lib/store/index.ts:40-46`, `lib/store/index.ts:734-739`
**Issue:** `DEFAULT_PROGRESS` defined twice:

```typescript
// Line 40
const DEFAULT_PROGRESS = { ... };

// Line 734 (inside resetVerseProgress)
const DEFAULT_PROGRESS = { ... };
```

**Suggested Fix:** Reuse the constant, or import from types file.

### 6. Mixed `any` Types in Junction Query (MEDIUM)
**File:** `lib/store/index.ts:207`
**Issue:** Junction query result typed as `any`:

```typescript
const verses = data.map((vc: any) => ({
  id: vc.user_verses.client_id,
```

**Suggested Fix:** Define proper type for junction query result.

### 7. Inconsistent Error Handling (MEDIUM)
**File:** Throughout store
**Issue:** Some methods throw, some return silently, some set error state:

```typescript
// addCollection throws
throw new Error('Failed to create collection');

// updateVerseProgress returns silently
if (error) {
  console.error('[STORE] Failed to update progress:', error);
  return; // Silent failure!
}

// fetchCollections sets error state
set({ error: 'Failed to load collections' });
```

### 8. Selector Memoization Not Fully Optimized (LOW)
**File:** `lib/store/index.ts:786-791`
**Issue:** `useShallow` wraps entire verses array, but filter is done after:

```typescript
export function useVersesByCollection(collectionId: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(
    () => verses.filter((v) => v.collectionId === collectionId),
    [verses, collectionId]
  );
}
```

Any verse change triggers all `useVersesByCollection` selectors to recompute.

---

## Future-Proofing Issues

### 9. Monolithic Store (MEDIUM)
**File:** `lib/store/index.ts` (886 lines)
**Issue:** Single file handles:
- Collections CRUD
- Verses CRUD
- Mastered verses
- Settings (color mode, bible version)
- All selectors

**Suggested Fix:** Split into slices:
- `store/collections.ts`
- `store/verses.ts`
- `store/settings.ts`

### 10. No Store Versioning (MEDIUM)
**Issue:** If `progress` schema changes, old data breaks. No migration path for cached data.

### 11. No Middleware for Debugging (LOW)
**Issue:** No devtools, logging, or analytics middleware configured.

**Suggested Fix:**
```typescript
const useAppStore = create<AppState>()(
  devtools(
    // ... store
  )
);
```

### 12. Hardcoded Bible Versions (LOW)
**File:** `lib/store/index.ts:279`
**Issue:** Valid versions hardcoded in hydration validation:

```typescript
if (savedBibleVersion && ['ESV', 'NLT'].includes(savedBibleVersion)) {
```

Adding KJV requires code change.

---

## Scale Issues

### 13. Full Refetch on Every Mutation (HIGH)
**Files:** `lib/store/index.ts:577-581, 653-656, 752-756`
**Issue:** Add/delete/reset all trigger full refetch:

```typescript
await Promise.all([
  get().fetchVerses(),
  get().fetchMasteredVerses(),
]);
```

At scale: 10,000 verses × 2 API calls = terrible performance.

### 14. Selector Recomputation on Any Verse Change (MEDIUM)
**File:** `lib/store/index.ts:834-860` (useInsightsStats)
**Issue:** Heavy computation on every verses change:

```typescript
export function useInsightsStats() {
  const verses = useAppStore(useShallow((state) => state.verses));
  // Filters, maps, Set operations on EVERY verses change
}
```

### 15. No Debouncing on Settings Changes (LOW)
**File:** `lib/store/index.ts:315-331`
**Issue:** Every settings change writes to AsyncStorage immediately:

```typescript
setColorMode: async (mode: ColorMode) => {
  set({ colorMode: mode });
  await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
};
```

Rapid toggling = rapid writes.

---

## Architectural Concerns

### 16. Store Directly Calls Supabase (MEDIUM)
**Issue:** Store mixes state management with data fetching:

```typescript
const { data, error } = await supabase
  .from('user_collections')
  .select('*')
```

Better: Store calls service layer, service calls Supabase.

### 17. No Subscription to Real-time Updates (MEDIUM)
**Issue:** Store only updates on explicit fetch/refresh. No real-time sync.

**Impact:** Multi-device use shows stale data until manual refresh.

### 18. Implicit Auth Dependency (LOW)
**File:** `lib/store/index.ts:118-123`
**Issue:** `getCurrentUserId()` calls `ensureAuth()` which may create anonymous user:

```typescript
async function getCurrentUserId(): Promise<string> {
  await ensureAuth(); // May create anonymous user!
  const { data: { user } } = await supabase.auth.getUser();
```

---

## Positive Observations

1. **Good Selector Pattern**: Uses `useShallow` and `useMemo` correctly
2. **Well-typed Interface**: `AppState` interface is comprehensive
3. **Engraved Logic**: `isConsecutiveMonth` helper is clean
4. **Settings Persistence**: Properly persists color mode across sessions
5. **Mastered Separation**: Keeping mastered verses in separate array is good

---

## Tickets to Create

- [ ] STATE-001: Implement optimistic updates for addVerse/deleteVerse (HIGH)
- [ ] STATE-002: Add pagination to fetchVerses (HIGH)
- [ ] STATE-003: Fix partial hydration failure (MEDIUM-HIGH)
- [ ] STATE-004: Add transaction for collection delete (MEDIUM-HIGH)
- [ ] STATE-005: Split store into slices (MEDIUM)
- [ ] STATE-006: Add devtools middleware (LOW)
- [ ] STATE-007: Remove duplicate DEFAULT_PROGRESS (LOW)
- [ ] STATE-008: Type junction query results (MEDIUM)
- [ ] STATE-009: Standardize error handling (throw vs set state) (MEDIUM)
- [ ] STATE-010: Add store schema versioning (MEDIUM)

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `lib/store/index.ts` | 886 | ✅ Reviewed |

---

## Next Section
Continue with `BY_LAYER/API-Layer/`
