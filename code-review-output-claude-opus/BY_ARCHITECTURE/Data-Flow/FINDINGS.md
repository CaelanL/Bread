[STATUS: review_done_needs_followup]

# BY_ARCHITECTURE/Data-Flow Code Review

## Summary
Data flows from UI → Zustand Store → Supabase (server) with session caching for Bible verses. The architecture is straightforward but has several inefficiencies: full data refetches on mutations, no real-time sync, and data duplication between store arrays. The data flow is predictable but not optimized for scale.

---

## Data Flow Analysis

### Path 1: Adding a Verse to Collection

```
User Action (Select Verse)
    ↓
lib/store/index.ts:addVerse()
    ↓
getCurrentUserId() → ensureAuth() (may create anon user)
    ↓
Supabase: Get collection server ID
    ↓
Supabase: Check if verse exists (upsert pattern)
    ↓
Supabase: Insert/restore verse + junction entry
    ↓
Full refetch: fetchVerses() + fetchMasteredVerses()  ← INEFFICIENT
    ↓
Zustand store updated
    ↓
UI re-renders via selectors
```

**Issues:**
1. **Full refetch instead of optimistic update** - 500ms+ latency
2. **Two API calls after mutation** - fetchVerses + fetchMasteredVerses
3. **No local update** - If server fails, UI shows stale state

### Path 2: Recording a Study Attempt

```
User Records Audio
    ↓
app/session.tsx: Recording captured with expo-av
    ↓
hooks/use-study-session.ts:processRecording()
    ↓
lib/api/recording.ts:processRecording() → POST to edge function
    ↓
Edge Function: transcribeWithSoniox() → Poll for result
    ↓
Edge Function: (Optional) cleanTranscription() [DISABLED]
    ↓
Response: { transcription, cleanedTranscription }
    ↓
lib/align.ts:alignTranscription() → LOCAL alignment (good!)
    ↓
lib/study-chunks.ts:calculateChunkScore()
    ↓
lib/store/index.ts:updateVerseProgress()
    ↓
Supabase: Update progress JSON field
    ↓
Local store updated (GOOD - no refetch)
    ↓
lib/api/analytics.ts:logSessionAttempt() → Fire-and-forget
    ↓
UI shows result
```

**Issues:**
1. **60-second transcription timeout** - Poor UX on slow connection
2. **Analytics is fire-and-forget** - No guarantee of logging
3. **Progress update doesn't trigger mastered verse refetch** - Could become stale

### Path 3: Fetching Bible Verses

```
Component needs verse text
    ↓
lib/api/bible.ts:getVerseText()
    ↓
Check: verse.text already populated? → Return immediately
    ↓
Check: getSavedVerseFromSession() → Session cache hit? → Return
    ↓
fetchVerse() → Check session cache for parsed reference
    ↓
API Call: GET /functions/v1/bible?ref=...&version=...
    ↓
Edge Function: Check verse_cache table (server-side cache)
    ↓
Edge Function: If miss, fetch from external Bible API (ESV/NLT)
    ↓
Edge Function: Cache in verse_cache table
    ↓
Response: { text, reference, version }
    ↓
setSavedVerseInSession() → Client session cache
    ↓
Return text
```

**Issues:**
1. **Three-layer caching** - verse.text, session cache, server cache - complex
2. **No cache invalidation strategy** - If Bible text is corrected, cached forever
3. **Session cache unbounded** - Can grow indefinitely

---

## Critical Issues

### 1. Data Duplication Between Arrays (HIGH)
**File:** `lib/store/index.ts`
**Issue:** Mastered verses exist in two places:
- `verses[]` - via junction query
- `masteredVerses[]` - via direct query

```typescript
// A mastered verse appears in both arrays with potentially different data
const verses: SavedVerse[] = [...]; // From verse_collections join
const masteredVerses: SavedVerse[] = [...]; // From user_verses direct
```

**Impact:** Same verse can have different `progress` or `createdAt` in each array if updates don't sync.

### 2. Full Refetch Pattern (HIGH)
**Files:** `lib/store/index.ts:577-581, 653-656, 752-756`
**Issue:** Every mutation triggers full data reload:

```typescript
await Promise.all([
  get().fetchVerses(),
  get().fetchMasteredVerses(),
]);
```

**Impact:** Adding one verse downloads entire verse history.

### 3. No Real-time Sync (MEDIUM)
**Issue:** Changes on one device don't appear on another until manual refresh. No Supabase Realtime subscription.

**Impact:** Multi-device use shows stale data.

### 4. Inconsistent Data Flow Direction (MEDIUM)
**Files:** Various
**Issue:** Some operations update local state first, others wait for server:

```typescript
// addCollection: Optimistic (good)
set((state) => ({ collections: [...state.collections, newCollection] }));

// addVerse: Server-first (bad)
await supabase.from('user_verses').insert({...});
await get().fetchVerses(); // Full refetch
```

---

## Code Quality Issues

### 5. Data Normalization Problems (MEDIUM)
**Issue:** `SavedVerse` contains denormalized data:

```typescript
interface SavedVerse {
  collectionId: string; // Denormalized - verse can be in multiple collections
  // ...
}
```

A verse in 3 collections = 3 `SavedVerse` objects with same `id` but different `collectionId`.

### 6. Progress Data Embedded in Verse (LOW)
**Issue:** `progress` is stored inside verse document:

```typescript
interface SavedVerse {
  progress: VerseProgress; // Nested, not normalized
}
```

Alternative: Separate `verse_progress` table would allow cleaner queries.

### 7. Date Inconsistency (LOW)
**Issue:** Some dates are `number` (timestamp), others are ISO strings:

```typescript
// SavedVerse
createdAt: number; // Timestamp

// Server response
created_at: string; // ISO string
```

---

## Scale Issues

### 8. Linear Growth of Store (HIGH)
**Issue:** All verses loaded into memory:

```typescript
verses: SavedVerse[]; // All verses in all collections
```

User with 10,000 verses = 10,000+ objects in memory.

**Suggested Fix:** Virtual list + on-demand loading.

### 9. No Data Pagination (HIGH)
**Issue:** `fetchVerses()` returns ALL verses:

```typescript
const { data, error } = await supabase
  .from('verse_collections')
  .select(`...`)
  // No limit, no offset
```

### 10. Selector Recomputation (MEDIUM)
**File:** `lib/store/index.ts:786-791`
**Issue:** Every verse change triggers all `useVersesByCollection` selectors:

```typescript
export function useVersesByCollection(collectionId: string) {
  const verses = useAppStore(useShallow((state) => state.verses));
  return useMemo(() => verses.filter(...), [verses, collectionId]);
}
```

Adding verse to Collection A recomputes filter for Collection B, C, D...

---

## Future-Proofing Issues

### 11. Hard to Add Data Types (MEDIUM)
**Issue:** Adding a new entity (e.g., "Study Plans") requires:
- New Supabase table
- New store array
- New fetch method
- New loading state
- New selectors

No abstraction for entity management.

### 12. No Offline Data Strategy (MEDIUM)
**Issue:** All data flows require connectivity. No:
- Offline cache
- Sync queue
- Conflict resolution

### 13. No Data Versioning (LOW)
**Issue:** `progress` schema changes would break existing data. No migration path.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │                     UI LAYER                        │    │
│  │   Screens → Components → useXxx() hooks            │    │
│  └────────────────────────┬────────────────────────────┘    │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────┐    │
│  │               ZUSTAND STORE                         │    │
│  │   collections[], verses[], masteredVerses[]         │    │
│  │   ┌─────────────┐  ┌───────────────┐               │    │
│  │   │ Selectors   │  │ Actions       │               │    │
│  │   │ useVerses() │  │ addVerse()    │               │    │
│  │   └─────────────┘  └───────┬───────┘               │    │
│  └────────────────────────────┼────────────────────────┘    │
│                               │                              │
│  ┌────────────────────────────▼────────────────────────┐    │
│  │                  API LAYER                          │    │
│  │   lib/api/bible.ts, recording.ts, analytics.ts      │    │
│  │   ┌──────────────────────────────┐                  │    │
│  │   │ Session Cache                │                  │    │
│  │   │ (Bible verses in memory)     │                  │    │
│  │   └──────────────────────────────┘                  │    │
│  └────────────────────────────┬────────────────────────┘    │
└───────────────────────────────┼─────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   SUPABASE EDGE       │
                    │   FUNCTIONS           │
                    │   /bible, /process-   │
                    │   recording           │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   SUPABASE DATABASE   │
                    │   user_verses         │
                    │   user_collections    │
                    │   verse_collections   │
                    │   verse_cache         │
                    │   session_attempts    │
                    └───────────────────────┘
```

---

## Tickets to Create

- [ ] DATA-001: Implement optimistic updates for all mutations (HIGH)
- [ ] DATA-002: Add pagination to verse fetching (HIGH)
- [ ] DATA-003: Normalize mastered verses (don't duplicate) (HIGH)
- [ ] DATA-004: Add Supabase Realtime subscription for sync (MEDIUM)
- [ ] DATA-005: Standardize optimistic vs server-first pattern (MEDIUM)
- [ ] DATA-006: Add offline data cache and sync queue (MEDIUM)
- [ ] DATA-007: Refactor selectors for better performance (MEDIUM)
- [ ] DATA-008: Add data schema versioning (LOW)

---

## Files Reviewed

Referenced files from previous reviews:
- `lib/store/index.ts` - State management, data storage
- `lib/api/*.ts` - API layer, data transmission
- `hooks/use-study-session.ts` - Study flow data handling
- `app/session.tsx` - Recording data flow

---

## Next Section
Continue with `BY_ARCHITECTURE/Type-Safety/`
