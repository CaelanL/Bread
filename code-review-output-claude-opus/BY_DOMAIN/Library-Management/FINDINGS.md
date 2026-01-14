[STATUS: review_done_needs_followup]

# BY_DOMAIN/Library-Management Code Review

## Summary
Library Management handles verse collections, organization, and CRUD operations. The architecture uses Supabase as source of truth with a junction table (`verse_collections`) for many-to-many relationships. The UI uses ScrollView rather than FlatList for collections/verses, which will become a performance issue at scale.

---

## Critical Issues

### 1. No List Virtualization (HIGH)
**Files:** `app/(tabs)/(library)/index.tsx:112-135`, `app/(tabs)/(library)/[id].tsx:118-143`
**Issue:** Both library screen and collection view use `ScrollView` with `.map()` instead of `FlatList`:

```typescript
// index.tsx - collections
<ScrollView>
  {collections.map((collection, index) => (
    <CollectionCard key={collection.id} ... />
  ))}
</ScrollView>

// [id].tsx - verses
<ScrollView>
  {sortedVerses.map((v, i) => (
    <SwipeableVerseCard key={v.id} ... />
  ))}
</ScrollView>
```

**Impact at Scale:**
- 100+ collections: All cards rendered, ~10MB memory
- 1000+ verses: Severe jank, potential OOM on older devices
- Stagger animations (`FadeInDown.delay(index * 60)`) compound the problem

**Suggested Fix:** Replace with `FlatList` using `windowSize`, `initialNumToRender`, `maxToRenderPerBatch` optimization.

### 2. N+1 Query Pattern in Collection Verse Counts (HIGH)
**File:** `app/(tabs)/(library)/index.tsx:26-52`
**Issue:** Each `CollectionCard` component calls `useCollectionVerseCount(collection.id)` which triggers a Supabase query:

```typescript
function CollectionCard({ collection, index, ... }) {
  const collectionVerseCount = useCollectionVerseCount(collection.id);
  // This is called PER CARD
}
```

**Impact:** N collections = N+1 queries (1 for collections + N for counts).

**Suggested Fix:** Batch fetch counts in a single query:
```sql
SELECT collection_id, COUNT(*) as count
FROM verse_collections
GROUP BY collection_id
```

### 3. Missing Optimistic Updates (HIGH)
**File:** `lib/storage/index.ts:141-165` (createCollection), `lib/storage/index.ts:480-551` (deleteVerse)
**Issue:** All CRUD operations wait for Supabase response before updating UI:

```typescript
export async function createCollection(name: string): Promise<Collection> {
  // ...await supabase call...
  // UI only updates AFTER server response
}
```

**Impact:** 200-500ms latency on every operation. Poor UX for rapid actions.

**Suggested Fix:** Implement optimistic updates in Zustand store:
1. Update local state immediately
2. Make API call in background
3. Revert on failure

### 4. Race Condition on Collection Delete (MEDIUM-HIGH)
**File:** `lib/storage/index.ts:169-224`
**Issue:** Delete collection has multiple sequential operations without transaction:
1. Get collection server UUID
2. Get default collection server ID
3. Get verse links
4. Move verses to default
5. Delete junction entries
6. Soft-delete collection

If any step fails, data can be in inconsistent state.

**Suggested Fix:** Use Supabase stored procedure or RPC call to make this atomic.

---

## Code Quality Issues

### 5. Hardcoded `any` Type in Storage (MEDIUM)
**File:** `lib/storage/index.ts:276, 322`
**Issue:** Junction table query results typed as `any`:

```typescript
return data.map((vc: any) => ({
  id: vc.user_verses.client_id,
  // ...
}));
```

**Suggested Fix:** Create proper types for junction query results.

### 6. Duplicate Mastered Check Logic (MEDIUM)
**Files:** `components/library/SwipeableVerseCard.tsx:101`, `lib/storage/index.ts:493`
**Issue:** Mastered check duplicated:

```typescript
// SwipeableVerseCard.tsx
const isMastered = verse.progress?.hard?.completed === true;

// storage/index.ts
const isMastered = verse?.progress?.hard?.completed === true;
```

**Suggested Fix:** Create `isMastered(verse)` helper function.

### 7. Modal State Not Reset on Error (LOW)
**File:** `components/library/AddCollectionModal.tsx:53-59`
**Issue:** If `onAdd` throws, modal closes but name isn't reset:

```typescript
const handleSubmit = () => {
  if (name.trim()) {
    onAdd(name.trim()); // If this throws...
    setName('');        // ...this never runs
    onClose();
  }
};
```

**Suggested Fix:** Use try/catch or move state reset before async call.

### 8. Inconsistent Error Handling in Storage (MEDIUM)
**File:** `lib/storage/index.ts`
**Issue:** Some functions return empty arrays on error, others throw:

```typescript
// Returns empty array - silent failure
export async function getCollections(): Promise<Collection[]> {
  if (error) {
    console.error('[STORAGE] Failed to fetch collections:', error);
    return [DEFAULT_COLLECTION]; // Fallback
  }
}

// Throws - explicit failure
export async function createCollection(name: string): Promise<Collection> {
  if (error) {
    throw new Error('Failed to create collection');
  }
}
```

**Suggested Fix:** Consistent error handling strategy across all storage functions.

---

## Future-Proofing Issues

### 9. No Support for Verse Reordering (MEDIUM)
**File:** `lib/storage/index.ts`
**Issue:** No `order` or `position` field in junction table. Verses sorted only by `added_at`.

**Impact:** Can't implement drag-to-reorder without schema migration.

### 10. No Collection Metadata Fields (LOW)
**File:** `lib/storage/index.ts:45-53`
**Issue:** Collection only has `name`, `isDefault`, `isVirtual`, `icon`, `iconColor`. No:
- Description
- Tags
- Color (beyond icon)
- Custom sort order

**Impact:** Hard to add rich collection features later.

### 11. Client ID Generation Not Collision-Safe (MEDIUM)
**File:** `lib/storage/index.ts:143, 431`
**Issue:** Client IDs use timestamp which can collide:

```typescript
const clientId = `collection-${Date.now()}`;
const clientId = `${verse.book}-${verse.chapter}-${verse.verseStart}-${verse.verseEnd}-${Date.now()}`;
```

**Impact:** If two operations happen in same millisecond, collision. Rare but possible.

**Suggested Fix:** Use UUID v4 or nanoid.

### 12. Hardcoded Default Collection Name (LOW)
**File:** `lib/storage/index.ts:68-73`
**Issue:** "My Verses" is hardcoded, not localizable:

```typescript
const DEFAULT_COLLECTION: Collection = {
  name: 'My Verses', // Hardcoded
  // ...
};
```

---

## Scale Issues

### 13. Full Data Fetch on Every Refresh (HIGH)
**File:** `lib/storage/index.ts:259-291`
**Issue:** `getSavedVerses()` fetches ALL verses with no pagination:

```typescript
const { data, error } = await supabase
  .from('verse_collections')
  .select(`...`)
  // No .limit() or .range()
```

**Impact at Scale:** User with 10,000 verses downloads all on every refresh.

**Suggested Fix:** Implement cursor-based pagination.

### 14. Stagger Animation Creates O(n) Delays (MEDIUM)
**File:** `components/library/SwipeableVerseCard.tsx:141-144`
**Issue:** Animation delay is linear with index:

```typescript
entering={FadeInDown.delay(index * 60).duration(300)}
```

**Impact:** 100 items = 6 second animation sequence. 1000 items = 60 seconds.

**Suggested Fix:** Cap delay or only animate visible items.

### 15. Verse Text Loaded Per Card (MEDIUM)
**File:** `components/library/SwipeableVerseCard.tsx:50-57`
**Issue:** Each card independently fetches verse text if not cached:

```typescript
useEffect(() => {
  if (!verse.text) {
    getVerseText(verse).then(setText)...
  }
}, [verse]);
```

**Impact:** N cards without text = N API calls.

**Suggested Fix:** Batch prefetch visible verse texts.

---

## Architectural Concerns

### 16. Virtual Collection Special-Casing (MEDIUM)
**Files:** `app/(tabs)/(library)/index.tsx:37-41`, `app/(tabs)/(library)/[id].tsx:27-28, 38`
**Issue:** Mastered collection has special handling scattered throughout:

```typescript
const isMasteredCollection = id === MASTERED_COLLECTION_ID;
const verses = isMasteredCollection ? masteredVerses : collectionVerses;
```

This will get worse as more virtual collections are added (e.g., "Recently Practiced", "Due for Review").

**Suggested Fix:** Abstract virtual collection behavior into a collection type system.

### 17. Storage Functions Mix Supabase and Business Logic (MEDIUM)
**File:** `lib/storage/index.ts`
**Issue:** Storage layer does more than persistence:
- `deleteVerse` decides soft vs hard delete based on mastery
- `saveVerse` handles restore logic
- `deleteCollection` handles verse migration

**Suggested Fix:** Separate persistence layer from business logic layer.

---

## Security Considerations

### 18. No Input Validation on Collection Name (LOW)
**File:** `components/library/AddCollectionModal.tsx:53-59`
**Issue:** Collection name only checked for emptiness:

```typescript
if (name.trim()) {
  onAdd(name.trim());
}
```

No validation for:
- Maximum length
- Prohibited characters
- XSS-like content (though RN is safer than web)

---

## Tickets to Create

- [ ] LIB-001: Replace ScrollView with virtualized FlatList (HIGH)
- [ ] LIB-002: Batch fetch collection verse counts (HIGH)
- [ ] LIB-003: Implement optimistic updates for CRUD (HIGH)
- [ ] LIB-004: Make collection delete atomic with stored procedure (MEDIUM-HIGH)
- [ ] LIB-005: Add pagination to verse fetching (HIGH)
- [ ] LIB-006: Cap stagger animation delay (MEDIUM)
- [ ] LIB-007: Type junction table query results (MEDIUM)
- [ ] LIB-008: Use UUID for client IDs (MEDIUM)
- [ ] LIB-009: Abstract virtual collection handling (MEDIUM)
- [ ] LIB-010: Add order field to verse_collections for reordering (MEDIUM)

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/(tabs)/(library)/index.tsx` | 182 | ✅ Reviewed |
| `app/(tabs)/(library)/[id].tsx` | 205 | ✅ Reviewed |
| `components/library/SwipeableVerseCard.tsx` | 301 | ✅ Reviewed |
| `components/library/AddCollectionModal.tsx` | 242 | ✅ Reviewed |
| `lib/storage/index.ts` | 674 | ✅ Reviewed |

---

## Next Section
Continue with `BY_DOMAIN/Authentication/`
