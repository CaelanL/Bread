[STATUS: review_done_needs_followup]

# Library-Management Domain Review

## Summary
The Library Management domain implements collection and verse organization with a well-structured approach using Zustand for state management and direct Supabase writes. However, there are significant concerns around scale, race conditions, error handling, and data consistency that need addressing before production at scale.

---

## Critical Issues

### 1. Race Condition in Verse Addition with Duplicates
**File:** `lib/store/index.ts` (lines ~480-530)
**Severity:** CRITICAL
**Issue:**
- `addVerse()` checks if a verse exists using `.maybeSingle()`, then either updates or inserts
- No transaction wrapping these operations
- Between the check and insert, another client could insert the same verse
- Soft-deleted verses can be "undeleted" by adding to a collection again, but this logic is implicit and hard to follow
- Creates duplicate verse entries across collections

**Impact:**
- Database consistency violations
- User sees same verse multiple times
- Progress data loss when duplicates are created
- Audit trail confusion

**Suggested Fix:**
```typescript
// Use database conflict resolution instead of application-level check
const { error } = await supabase.from('user_verses').upsert({
  user_id: userId,
  client_id: clientId,
  // ... other fields
  // Use ON CONFLICT DO UPDATE to handle duplicates
}, { onConflict: 'client_id' });
```

**Ticket:** Create task: "Fix verse addition race condition with upsert"

---

### 2. Data Loss on Collection Deletion
**File:** `lib/store/index.ts` (lines ~367-429)
**Severity:** CRITICAL
**Issue:**
- When deleting a collection, verses are moved to default collection
- BUT: If default collection lookup fails (line 391), deletion is aborted
- However, the error handling doesn't ensure atomic operation
- If the collection soft-delete succeeds but verse reassignment fails, collection is deleted but verses become orphaned
- No rollback mechanism

**Impact:**
- Orphaned verses in database (collection_id references deleted collection)
- User data loss and confusion
- Analytics data corruption
- Difficult to recover

**Suggested Flow (Current is NOT atomic):**
```
1. Check default exists
2. Soft-delete collection ← SUCCESS, but...
3. Move verses to default ← FAILS
→ Collection deleted but verses orphaned
```

**Suggested Fix:**
Implement database-level constraint:
```sql
-- In migration, make collection_id NOT NULL and add foreign key
ALTER TABLE user_verses 
ADD CONSTRAINT fk_collection_id FOREIGN KEY (collection_id) 
REFERENCES user_collections(id) ON DELETE CASCADE;
```

Or use database transaction:
```typescript
// Use Supabase transaction wrapper
await supabase.rpc('delete_collection_with_verses', {
  collection_id: collection.id,
  default_collection_id: defaultCollection.id,
});
```

**Ticket:** Create task: "Implement atomic collection deletion with transaction"

---

### 3. Mastered Verses Not Properly Scoped by Collection
**File:** `lib/store/index.ts` (lines ~228-264)
**Severity:** HIGH
**Issue:**
- `fetchMasteredVerses()` returns ALL mastered verses across all collections with NO deleted_at filter
- This is intentional (comment says "NO deleted_at filter") but dangerous
- Verses from deleted collections appear in Mastered list
- Soft-deleted verses stay mastered forever
- No way to remove a verse from Mastered except by reducing accuracy below 90%

**Impact:**
- Mastered collection grows indefinitely, never shrinks
- Deleted collection data pollutes Mastered list
- User confusion ("why is this old verse still here?")
- Performance degradation with large mastered sets

**Suggested Fix:**
```typescript
// Only show mastered verses from non-deleted collections
const { data, error } = await supabase
  .from('user_verses')
  .select(`
    *,
    collection:collection_id(deleted_at)
  `)
  .eq('progress->hard->completed', true)
  .is('collection.deleted_at', null)  // Only from active collections
  .is('deleted_at', null)  // Only non-deleted verses
  .order('updated_at', { ascending: false });
```

**Ticket:** Create task: "Filter mastered verses to exclude deleted collections/verses"

---

### 4. No Transaction Handling for Multi-Step Operations
**File:** `lib/sync/migration.ts`, `lib/store/index.ts`
**Severity:** HIGH
**Issue:**
- Migration loops through collections and verses, inserting them one-by-one
- No rollback if one insert fails mid-migration
- Collection created but verses not synced leaves inconsistent state
- No idempotency - re-running migration could create duplicates

**Impact:**
- Failed migrations leave corrupted state
- Requires manual database cleanup
- User can't re-trigger migration safely
- Data integrity issues

**Suggested Fix:**
```typescript
// Use a database transaction or mark migration atomically
export async function migrateLocalDataToServer(): Promise<void> {
  const migrationId = generateUUID();
  const isComplete = await isMigrationComplete();
  if (isComplete) return;

  try {
    // Mark migration in progress BEFORE starting
    await AsyncStorage.setItem(`migration_${migrationId}_in_progress`, 'true');
    
    // Perform all operations...
    
    // Only mark complete if ALL succeed
    await markMigrationComplete();
    await AsyncStorage.removeItem(`migration_${migrationId}_in_progress`);
  } catch (e) {
    // Cleanup in-progress marker to allow retry
    await AsyncStorage.removeItem(`migration_${migrationId}_in_progress`);
    throw e;
  }
}
```

**Ticket:** Create task: "Add idempotent migration with rollback support"

---

## Code Quality Issues

### 1. Unsafe Type Casting in fetchVerses
**File:** `lib/store/index.ts` (line 206)
**Severity:** MEDIUM
**Issue:**
```typescript
const verses = data.map((vc: any) => ({  // ← any type!
  id: vc.user_verses.client_id,
  collectionId: vc.user_collections.client_id,
  // ...
}));
```
- Uses `any` type annotation
- No validation that nested objects exist
- Runtime error if query returns unexpected structure
- No runtime safety

**Impact:**
- Silent failures if schema changes
- Crashes if Supabase response structure changes
- Hard to debug

**Suggested Fix:**
```typescript
interface VerseCollection {
  added_at: string;
  user_collections: { client_id: string };
  user_verses: {
    client_id: string;
    book: string;
    chapter: number;
    verse_start: number;
    verse_end: number;
    version: BibleVersion;
    progress?: VerseProgress;
    deleted_at: string | null;
  };
}

const verses = data.map((vc: VerseCollection) => ({
  // Now type-safe
}));
```

**Ticket:** Create task: "Add proper TypeScript types for Supabase responses"

---

### 2. Silent Error Handling in Collection Operations
**File:** `lib/store/index.ts` (multiple locations)
**Severity:** MEDIUM
**Issue:**
- Error handling catches exceptions but doesn't propagate user-friendly messages
- `addCollection()` throws generic "Failed to create collection"
- No differentiation between network errors, auth errors, validation errors
- UI has no way to show specific error to user

**Impact:**
- Poor UX when operations fail
- Users don't know if it's their fault or server issue
- Difficult to debug for support

**Suggested Fix:**
```typescript
enum CollectionErrorType {
  NETWORK_ERROR = 'network_error',
  AUTH_ERROR = 'auth_error',
  NAME_TOO_LONG = 'name_too_long',
  UNKNOWN = 'unknown',
}

class CollectionError extends Error {
  constructor(public type: CollectionErrorType, message: string) {
    super(message);
  }
}
```

**Ticket:** Create task: "Add error classification to collection operations"

---

### 3. Missing Loading States for Collection Operations
**File:** `app/(tabs)/(library)/index.tsx`, `components/library/AddCollectionModal.tsx`
**Severity:** MEDIUM
**Issue:**
- No loading indicator during collection creation
- Modal closes immediately even if API call is pending
- User might close app thinking operation failed
- AddCollectionModal doesn't show loading state

**Impact:**
- User confusion about whether operation succeeded
- Accidental duplicate collection creation if user retries
- Poor perceived performance

**Suggested Fix:**
```typescript
// In AddCollectionModal
const [isLoading, setIsLoading] = useState(false);

const handleSubmit = async () => {
  if (name.trim()) {
    setIsLoading(true);
    try {
      await onAdd(name.trim());
      setName('');
      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }
};

// Show loading in button
<Pressable disabled={isLoading}>
  {isLoading ? <ActivityIndicator /> : 'Create Collection'}
</Pressable>
```

**Ticket:** Create task: "Add loading states to collection/verse operations"

---

### 4. Collection Name Validation Too Weak
**File:** `components/library/AddCollectionModal.tsx` (line 53)
**Severity:** MEDIUM
**Issue:**
```typescript
if (name.trim()) {  // Only checks if non-empty after trim
  onAdd(name.trim());
}
```
- No max length validation (database might reject)
- No check for special characters
- No protection against whitespace-only names
- User could create collection named "   " if not trimmed

**Impact:**
- Backend validation errors confuse users
- Inconsistent UX with other forms
- Potential security issue with unsanitized input

**Suggested Fix:**
```typescript
const validateCollectionName = (name: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const trimmed = name.trim();
  
  if (!trimmed) errors.push("Name cannot be empty");
  if (trimmed.length < 1) errors.push("Name too short");
  if (trimmed.length > 50) errors.push("Name too long (max 50 characters)");
  if (!/^[\w\s\-.,()'"]+$/.test(trimmed)) errors.push("Name contains invalid characters");
  
  return { valid: errors.length === 0, errors };
};
```

**Ticket:** Create task: "Add collection name validation"

---

## Future-Proofing Issues

### 1. No Support for Verse Reordering
**File:** `app/(tabs)/(library)/[id].tsx` (line 63)
**Severity:** HIGH
**Issue:**
```typescript
// Sort verses by createdAt descending - HARDCODED
const sortedVerses = [...verses].sort((a, b) => b.createdAt - a.createdAt);
```
- Sorting is hardcoded in component, not configurable
- No user-controlled reordering (drag-drop)
- No persistent ordering in database
- Adding reordering later requires major refactor

**Impact:**
- Can't implement user-requested features (custom ordering)
- Sorting logic scattered across components
- Difficult to add "last studied" or "custom order" options

**Suggested Fix:**
Add ordering metadata to database:
```sql
ALTER TABLE verse_collections ADD COLUMN sort_order INTEGER;
```

Then support multiple sort strategies:
```typescript
type VerseSort = 'date_added' | 'date_studied' | 'custom' | 'alphabetical';

const getSortedVerses = (verses: SavedVerse[], sortType: VerseSort) => {
  switch(sortType) {
    case 'date_added': return verses.sort((a, b) => b.createdAt - a.createdAt);
    case 'custom': return verses.sort((a, b) => a.sortOrder - b.sortOrder);
    // ...
  }
};
```

**Ticket:** Create task: "Design and implement verse ordering/reordering system"

---

### 2. No Support for Collection Sharing or Collaboration
**File:** All collection files
**Severity:** MEDIUM
**Issue:**
- Collections are completely siloed per user
- No sharing mechanism
- No collaborative editing
- Would require complete permission system redesign

**Impact:**
- Limited feature set vs competitors
- Can't build social features (study groups, shared plans)
- Enterprise features blocked

**Suggested Fix:**
Design future sharing:
```typescript
interface Collection {
  id: string;
  ownerId: string;  // Who created it
  sharedWith?: string[];  // Array of user IDs
  permissions?: {
    [userId: string]: 'read' | 'edit' | 'admin';
  };
}
```

**Ticket:** Create task: "Design collection sharing and permissions architecture"

---

### 3. No Bulk Operations
**File:** All collection/verse operations
**Severity:** MEDIUM
**Issue:**
- Only supports single verse add/delete
- No bulk move, bulk delete, bulk add
- Users with hundreds of verses can't perform operations efficiently
- Would require redesign to support

**Impact:**
- Poor UX at scale
- Users can't reorganize large collections efficiently
- Database will be hammered with individual requests

**Suggested Fix:**
Add bulk operation endpoints:
```typescript
const bulkAddVersesToCollection = async (verseIds: string[], collectionId: string) => {
  // Single batch operation to server
};

const bulkMoveVersesCollection = async (verseIds: string[], fromCollectionId: string, toCollectionId: string) => {
  // Atomic move operation
};
```

**Ticket:** Create task: "Design and implement bulk operations API"

---

## Architectural Concerns

### 1. Virtual Collections (Mastered) Not Properly Separated
**File:** `lib/store/index.ts`, `app/(tabs)/(library)/[id].tsx`
**Severity:** MEDIUM
**Issue:**
- Mastered collection is fake collection in array mixed with real collections
- Special cases everywhere for "virtual" collections
- Swipe-to-delete disabled with `.disableSwipe={isMasteredCollection}` (line 138 of [id].tsx)
- Filtering logic scattered (`if (isMasteredCollection) { ... } else { ... }`)

**Impact:**
- Hard to add new virtual collections (archived, favorites, etc.)
- Inconsistent handling of virtual vs real collections
- Risk of accidentally allowing operations on virtual collections

**Suggested Fix:**
Separate virtual collection handling:
```typescript
interface VirtualCollection extends Collection {
  isVirtual: true;
  getRules: (collectionId: string) => VirtualCollectionRules;
}

interface VirtualCollectionRules {
  canDelete: boolean;
  canAddVersesManually: boolean;
  canReorder: boolean;
  isEditable: boolean;
}

// Then use rules instead of checking collection.id
const rules = getVirtualCollectionRules(collection);
return <SwipeableVerseCard disableSwipe={!rules.canDelete} />;
```

**Ticket:** Create task: "Refactor virtual collections to use rules-based system"

---

### 2. Insufficient Separation of Concerns
**File:** `lib/store/index.ts` (enormous file)
**Severity:** MEDIUM
**Issue:**
- Single store file handles collections, verses, settings, migrations
- Collection operations mixed with verse operations
- Settings mixed with data operations
- No clear layer separation

**Impact:**
- Hard to test individual operations
- Changes to collection logic risk breaking verse logic
- File is 885 lines, hard to maintain

**Suggested Fix:**
Split into domain stores:
```
lib/store/
  ├── collection.store.ts
  ├── verse.store.ts
  ├── settings.store.ts
  └── index.ts (combines them)
```

**Ticket:** Create task: "Refactor store into domain-specific stores"

---

## Performance Issues

### 1. No Pagination or Virtualization for Large Lists
**File:** `app/(tabs)/(library)/index.tsx`, `app/(tabs)/(library)/[id].tsx`
**Severity:** HIGH
**Issue:**
- Uses `ScrollView` with all collections/verses rendered upfront
- No pagination for large collections
- At 1000+ verses, list will become sluggish
- No lazy loading

**Impact:**
- Poor performance with large libraries
- High memory usage
- UI blocking

**Suggested Fix:**
Use `FlatList` with virtualization:
```typescript
<FlatList
  data={sortedVerses}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <SwipeableVerseCard verse={item} />}
  initialNumToRender={20}
  maxToRenderPerBatch={30}
  windowSize={10}
/>
```

**Ticket:** Create task: "Implement FlatList virtualization for large collections"

---

### 2. Inefficient N+1 Query Pattern for Verse Counts
**File:** `app/(tabs)/(library)/index.tsx` (lines ~37-40)
**Severity:** MEDIUM
**Issue:**
```typescript
// For each collection, calls useCollectionVerseCount separately
collections.map((collection) => (
  <CollectionCard
    collection={collection}
    onPress={() => handleCollectionPress(collection)}
    onDelete={() => handleDeleteCollection(collection.id)}
  />
))

// Each CollectionCard calls:
const collectionVerseCount = useCollectionVerseCount(collection.id);  // N queries!
```
- One query per collection to get verse count
- With 100 collections, 100 separate queries
- Better to fetch all counts in single query

**Impact:**
- Unnecessary database load
- Slow library screen with many collections
- Poor API performance at scale

**Suggested Fix:**
Fetch all verse counts together:
```typescript
// In store
const getCollectionVerseCounts = async (): Promise<Record<string, number>> => {
  const { data } = await supabase
    .from('verse_collections')
    .select('collection_id, count(*)')
    .group_by('collection_id');
  
  return data.reduce((acc, row) => ({
    ...acc,
    [row.collection_id]: row.count,
  }), {});
};
```

**Ticket:** Create task: "Optimize verse count queries with aggregation"

---

### 3. Store Memoization Missing
**File:** `lib/store/index.ts`
**Severity:** LOW-MEDIUM
**Issue:**
- Custom hooks like `useCollectionVerseCount` likely recreate selectors on each render
- No memoization of derived state

**Impact:**
- Unnecessary re-renders
- Performance degradation with large datasets

**Suggested Fix:**
```typescript
export const useCollectionVerseCount = (collectionId: string) =>
  useAppStore(
    useCallback(
      (state) => state.verses.filter(v => v.collectionId === collectionId).length,
      [collectionId]
    )
  );
```

**Ticket:** Create task: "Add memoization to store selectors"

---

## Scale Issues

### 1. Collection Fetch Loads ALL Collections
**File:** `lib/store/index.ts` (line 146)
**Severity:** HIGH
**Issue:**
```typescript
const { data, error } = await supabase
  .from('user_collections')
  .select('*')  // ← Fetches ALL columns
  .is('deleted_at', null)
  .order('created_at', { ascending: true });
```
- Fetches all collection data (including metadata we might not need)
- No pagination or limit
- With 1000+ collections, large response payload

**Impact:**
- Slow app startup
- Large bandwidth usage
- Poor offline experience

**Suggested Fix:**
Paginate and select only needed columns:
```typescript
const { data, error } = await supabase
  .from('user_collections')
  .select('id, client_id, name, is_default, created_at')  // Only needed fields
  .is('deleted_at', null)
  .order('created_at', { ascending: true })
  .range(0, 99);  // Pagination
```

**Ticket:** Create task: "Add pagination and column selection to collection queries"

---

### 2. No Query Optimization for Verse Fetching
**File:** `lib/store/index.ts` (line 188-196)
**Severity:** HIGH
**Issue:**
- Joins across 3 tables every fetch
- Fetches ALL verse data for ALL collections
- No way to load verses for only one collection
- Response size grows linearly with total verses

**Impact:**
- Slow refreshes as library grows
- Large bandwidth usage
- Cold starts very slow

**Suggested Fix:**
Add collection-specific verse fetching:
```typescript
// Add to store
fetchVersesForCollection: async (collectionId: string) => {
  // Fetch only verses for this collection
  const { data } = await supabase
    .from('verse_collections')
    .select(`added_at, user_verses!inner(*)`)
    .eq('collection_id', collectionId)
    .is('user_verses.deleted_at', null);
  // ...
};
```

**Ticket:** Create task: "Add efficient collection-specific verse fetching"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Fix verse addition race condition with upsert | CRITICAL | Data Integrity |
| Implement atomic collection deletion with transaction | CRITICAL | Data Integrity |
| Filter mastered verses to exclude deleted collections/verses | HIGH | Data Consistency |
| Add idempotent migration with rollback support | HIGH | Reliability |
| Add proper TypeScript types for Supabase responses | MEDIUM | Type Safety |
| Add error classification to collection operations | MEDIUM | UX/Error Handling |
| Add loading states to collection/verse operations | MEDIUM | UX |
| Add collection name validation | MEDIUM | Quality |
| Design and implement verse ordering/reordering system | HIGH | Future-Proofing |
| Design collection sharing and permissions architecture | MEDIUM | Future-Proofing |
| Design and implement bulk operations API | MEDIUM | Future-Proofing |
| Refactor virtual collections to use rules-based system | MEDIUM | Architecture |
| Refactor store into domain-specific stores | MEDIUM | Architecture |
| Implement FlatList virtualization for large collections | HIGH | Performance |
| Optimize verse count queries with aggregation | MEDIUM | Performance |
| Add memoization to store selectors | LOW-MEDIUM | Performance |
| Add pagination and column selection to collection queries | HIGH | Scale |
| Add efficient collection-specific verse fetching | HIGH | Scale |

---

## Next Review Section
→ Continue with: `BY_DOMAIN/Study-Session`
