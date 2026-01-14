[STATUS: review_done_needs_followup]

# State-Management Layer Review

## Summary
The State-Management layer uses Zustand effectively for global state with well-organized fetch, mutation, and settings actions. However, the store file is monolithic (885 lines), has multiple race conditions in async operations, lacks middleware for debugging, and missing optimizations for derived state. The individual hooks are well-designed but underutilized.

---

## Critical Issues

### 1. Store File Too Large - Refactoring Needed
**File:** `lib/store/index.ts` (885 lines)
**Severity:** HIGH
**Issue:**
- Single file manages: collections, verses, mastered verses, settings, all mutations
- Hard to navigate and maintain
- Increases chance of bugs during editing
- Testing requires mocking entire store

**Impact:**
- Maintenance burden
- Higher likelihood of bugs
- Difficult onboarding
- Changes to one domain affect all subscriptions

**Suggested Fix:**
```typescript
// Split into separate slices
// lib/store/slices/collections.ts
export const createCollectionsSlice = (set, get) => ({
  collections: [],
  collectionsLoading: true,
  fetchCollections: async () => { /* ... */ },
  addCollection: async (name) => { /* ... */ },
  deleteCollection: async (id) => { /* ... */ },
});

// lib/store/slices/verses.ts
export const createVersesSlice = (set, get) => ({
  verses: [],
  versesLoading: true,
  fetchVerses: async () => { /* ... */ },
  addVerse: async (...) => { /* ... */ },
  deleteVerse: async (...) => { /* ... */ },
  updateVerseProgress: async (...) => { /* ... */ },
});

// lib/store/slices/settings.ts
export const createSettingsSlice = (set, get) => ({
  colorMode: 'system',
  bibleVersion: 'ESV',
  setColorMode: async (mode) => { /* ... */ },
  setBibleVersion: async (version) => { /* ... */ },
});

// lib/store/index.ts
export const useAppStore = create<AppState>((set, get) => ({
  ...createCollectionsSlice(set, get),
  ...createVersesSlice(set, get),
  ...createSettingsSlice(set, get),
}));
```

**Ticket:** Create task: "Refactor monolithic store into domain-specific slices"

---

### 2. Multiple Race Conditions in Async Store Operations
**File:** `lib/store/index.ts` (lines ~433-583, ~585-658, ~660-720)
**Severity:** CRITICAL
**Issue:**
Multiple operations have race conditions:

1. **addVerse** (lines 433-583):
```typescript
const { data: collection } = await supabase
  .from('user_collections')
  .select('id')
  .eq('client_id', collectionId)
  .is('deleted_at', null)
  .single();

// If collection deleted between check and insert, fails silently
const { error: junctionError } = await supabase
  .from('verse_collections')
  .upsert(...);
```

2. **deleteVerse** (lines 585-658):
```typescript
// Check collection exists
const { data: collectionData } = await supabase
  .from('user_collections')
  .select('id')
  .eq('client_id', collectionId)
  .single();

// Collection could be deleted before this point
const { error: junctionError } = await supabase
  .from('verse_collections')
  .delete()
  .eq('collection_id', collectionData.id);
```

**Impact:**
- Verses added to wrong collection
- Verses deleted from wrong collection
- Data corruption
- Silent failures

**Suggested Fix:**
Use database constraints and transactions:
```typescript
// Use database-enforced constraints
// And wrap in transaction at database level
export const addVerse = async (verse, collectionId, version) => {
  const result = await supabase.rpc('add_verse_safe', {
    p_collection_id: collectionId,
    p_verse_data: verse,
    p_version: version,
  });
  
  if (result.error) throw result.error;
  return result.data;
};
```

**Ticket:** Create task: "Fix race conditions in addVerse and deleteVerse operations"

---

### 3. No Selector Memoization - Unnecessary Re-renders
**File:** `lib/store/index.ts` (entire store)
**Severity:** HIGH
**Issue:**
```typescript
// In components, selectors not memoized
const collections = useAppStore((state) => state.collections);
const verses = useAppStore((state) => state.verses);

// Every component subscribes to entire store updates
// Any state change causes re-render, even unrelated ones
```
- No memoization of derived selectors
- Components re-render on ANY store update
- No shallow comparison optimization

**Impact:**
- Excessive re-renders
- Poor performance with many components
- Battery drain
- Jank when updating state

**Suggested Fix:**
```typescript
// Create memoized selectors
export const useCollections = () =>
  useAppStore((state) => state.collections);

export const useCollectionCount = () =>
  useAppStore((state) => state.collections.length);

// Or use selector library
export const useCollectionsSelector = (selector: (state: AppState) => T) =>
  useAppStore(selector, shallow);

// In components
const collections = useCollections(); // Memoized
const versesByCollection = useAppStore(
  (state) => state.verses.filter(v => v.collectionId === collectionId),
  (prev, next) => JSON.stringify(prev) === JSON.stringify(next)
);
```

**Ticket:** Create task: "Add memoized selectors to store to prevent unnecessary re-renders"

---

## Code Quality Issues

### 1. No Middleware for Debugging or Logging
**File:** `lib/store/index.ts`
**Severity:** MEDIUM
**Issue:**
- No way to trace state changes
- Can't debug mutation order
- No performance monitoring
- Devtools not integrated

**Impact:**
- Hard to debug state issues
- No visibility into state mutations
- Performance problems hard to identify

**Suggested Fix:**
```typescript
// Add Zustand middleware
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        // ... store implementation
      }),
      { name: 'app-store' }
    ),
    { name: 'AppStore', enabled: __DEV__ }
  )
);

// Or add custom logging
const withLogging = (config) => (set, get, api) => {
  return config(
    (...args) => {
      console.log('[STORE]', 'mutation', args);
      set(...args);
    },
    get,
    api
  );
};
```

**Ticket:** Create task: "Add Zustand devtools and logging middleware"

---

### 2. No Hydration Error Handling
**File:** `lib/store/index.ts` (lines ~266-297)
**Severity:** MEDIUM
**Issue:**
```typescript
hydrate: async () => {
  // Load settings from AsyncStorage (doesn't require auth)
  try {
    const [savedColorMode, savedBibleVersion] = await Promise.all([...]);
    // ...
  } catch (e) {
    console.error('[STORE] Failed to load settings:', e);
  }

  const [collectionsOk, versesOk, masteredOk] = await Promise.all([...]);
  // Only mark as hydrated if all fetches succeeded
  if (collectionsOk && versesOk && masteredOk) {
    set({ hydrated: true, error: null });
  }
  // ← But hydrated = false even on partial failure!
}
```
- If hydration partially fails, app remains in loading state
- User sees spinner indefinitely
- No recovery mechanism

**Impact:**
- App stuck in loading state
- Poor UX when network issue occurs
- Impossible to recover without app restart

**Suggested Fix:**
```typescript
hydrate: async () => {
  try {
    // Load settings
    try {
      const [savedColorMode, savedBibleVersion] = await Promise.all([...]);
      // Apply settings
    } catch (e) {
      console.error('[STORE] Settings load failed:', e);
      // Continue anyway with defaults
    }

    // Load data with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const [collectionsOk, versesOk, masteredOk] = await Promise.all([
        get().fetchCollections(),
        get().fetchVerses(),
        get().fetchMasteredVerses(),
      ]);
      clearTimeout(timeoutId);

      // Mark as hydrated if ANY fetch succeeded
      const partialSuccess = collectionsOk || versesOk || masteredOk;
      set({ hydrated: partialSuccess, error: null });

      if (!partialSuccess) {
        set({ error: 'Failed to load data. Pull to refresh.' });
      }
    } catch (e) {
      clearTimeout(timeoutId);
      // Show error but mark as hydrated to unblock UI
      set({ hydrated: true, error: 'Failed to load data. Pull to refresh.' });
    }
  } catch (e) {
    console.error('[STORE] Hydration error:', e);
    set({ hydrated: true, error: 'Failed to initialize app' });
  }
}
```

**Ticket:** Create task: "Add error recovery and timeout to store hydration"

---

### 3. Missing Verse Deduplication in AddVerse
**File:** `lib/store/index.ts` (lines ~480-490)
**Severity:** MEDIUM
**Issue:**
```typescript
// Check if verse already exists (including soft-deleted)
const { data: existing } = await supabase
  .from('user_verses')
  .select('id, client_id, deleted_at, progress')
  .eq('user_id', userId)
  .eq('book', verse.book)
  .eq('chapter', verse.chapter)
  .eq('verse_start', verse.verseStart)
  .eq('verse_end', verse.verseEnd)
  .eq('version', version)
  .maybeSingle();

// But doesn't prevent duplicate junction entries!
```
- If same verse added to same collection twice, duplicate entry created
- User sees verse twice in collection

**Impact:**
- Duplicate entries in collections
- User confusion
- Wrong verse count

**Suggested Fix:**
```typescript
// Use upsert with conflict handling
const { error: junctionError } = await supabase
  .from('verse_collections')
  .upsert(
    { 
      verse_id: existing.id, 
      collection_id: serverCollectionId, 
      added_at: createdAt.toISOString() 
    },
    { 
      onConflict: 'verse_id,collection_id',
      ignoreDuplicates: true 
    }
  );
```

**Ticket:** Create task: "Add constraint to prevent duplicate verse-collection entries"

---

## Performance Issues

### 1. useCountUp Hook Has Layout Thrashing
**File:** `hooks/use-count-up.ts` (lines ~42-56)
**Severity:** MEDIUM
**Issue:**
```typescript
const animate = (currentTime: number) => {
  const elapsed = currentTime - startTime;
  const progress = Math.min(elapsed / TOTAL_DURATION, 1);
  const value = Math.round(progress * target);
  setDisplayValue(value); // ← Triggers re-render in every frame
  
  if (progress < 1) {
    rafRef.current = requestAnimationFrame(animate);
  }
};
```
- Triggers state update in every animation frame (60fps)
- Causes re-render cascade
- Layout calculations on every frame
- Battery drain

**Impact:**
- High CPU usage during count-up
- Jank with other animations
- Battery drain

**Suggested Fix:**
```typescript
// Use Animated API instead
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export function useCountUpAnimated(target: number) {
  const animatedValue = useSharedValue(0);
  
  useEffect(() => {
    animatedValue.value = withTiming(target, {
      duration: 1000,
    });
  }, [target]);
  
  const animatedStyle = useAnimatedStyle(() => ({
    // Use animatedValue directly in Animated.Text
  }));
  
  return animatedStyle;
}
```

**Ticket:** Create task: "Refactor useCountUp to use Reanimated API"

---

### 2. Store Refresh Fetches All Data Even When Only Partial Update Needed
**File:** `lib/store/index.ts` (lines ~299-306)
**Severity:** MEDIUM
**Issue:**
```typescript
refresh: async () => {
  set({ error: null });
  await Promise.all([
    get().fetchCollections(),
    get().fetchVerses(),
    get().fetchMasteredVerses(), // ← Always fetches all 3
  ]);
}
```
- Pulls down entire datasets unnecessarily
- Bandwidth waste
- Slow on poor networks
- Blocks UI while fetching

**Impact:**
- Unnecessary data transfer
- Slow refresh operations
- Poor mobile UX

**Suggested Fix:**
```typescript
// Add selective refresh
refreshCollections: async () => {
  await get().fetchCollections();
},

refreshVerses: async () => {
  await get().fetchVerses();
},

refreshMasteredVerses: async () => {
  await get().fetchMasteredVerses();
},

refresh: async (options = { collections: true, verses: true, mastered: true }) => {
  set({ error: null });
  const tasks = [];
  if (options.collections) tasks.push(get().fetchCollections());
  if (options.verses) tasks.push(get().fetchVerses());
  if (options.mastered) tasks.push(get().fetchMasteredVerses());
  await Promise.all(tasks);
},
```

**Ticket:** Create task: "Add selective refresh operations to store"

---

## Future-Proofing Issues

### 1. No State Versioning or Migration System
**File:** `lib/store/index.ts`
**Severity:** MEDIUM
**Issue:**
- If store schema changes, no way to migrate persisted state
- Adding/removing fields breaks old app installs
- No version tracking

**Impact:**
- Breaking changes when deploying updates
- User app crashes on schema changes
- Need to force app reinstall

**Suggested Fix:**
```typescript
// Add store versioning
interface StoreMigration {
  version: number;
  migrate: (oldState: any) => AppState;
}

const migrations: StoreMigration[] = [
  {
    version: 1,
    migrate: (state) => ({
      ...state,
      // Migration logic
    }),
  },
];

const getCurrentStoreVersion = () => migrations[migrations.length - 1].version;

// In Zustand config
persist(
  (set, get) => ({ /* ... */ }),
  {
    name: 'app-store',
    version: getCurrentStoreVersion(),
    migrate: (persistedState, version) => {
      let state = persistedState;
      for (let i = version; i < getCurrentStoreVersion(); i++) {
        state = migrations[i].migrate(state);
      }
      return state;
    },
  }
)
```

**Ticket:** Create task: "Add store schema versioning and migration system"

---

### 2. No Optimistic Update Rollback
**File:** `lib/store/index.ts` (lines ~359-364)
**Severity:** MEDIUM
**Issue:**
```typescript
// Optimistically add to store
set((state) => ({
  collections: [...state.collections, newCollection],
}));

// But if server fails, collection stays in store!
```
- Optimistic updates don't rollback on failure
- User sees collection that doesn't exist on server
- Sync becomes corrupted

**Impact:**
- Inconsistent state between client and server
- Confusing UX
- Data corruption

**Suggested Fix:**
```typescript
addCollection: async (name: string) => {
  const optimisticId = `temp-${Date.now()}`;
  const optimisticCollection = { id: optimisticId, name, isDefault: false, createdAt: Date.now() };
  
  // Optimistically add
  set((state) => ({
    collections: [...state.collections, optimisticCollection],
  }));
  
  try {
    const userId = await getCurrentUserId();
    const clientId = `collection-${Date.now()}`;
    const createdAt = new Date();
    
    const { error } = await supabase.from('user_collections').insert({
      user_id: userId,
      client_id: clientId,
      name,
      is_default: false,
      created_at: createdAt.toISOString(),
    });
    
    if (error) throw error;
    
    // Replace optimistic with real
    set((state) => ({
      collections: state.collections.map(c =>
        c.id === optimisticId
          ? { id: clientId, name, isDefault: false, createdAt: createdAt.getTime() }
          : c
      ),
    }));
    
    return { id: clientId, name, isDefault: false, createdAt: createdAt.getTime() };
  } catch (error) {
    // Rollback optimistic update
    set((state) => ({
      collections: state.collections.filter(c => c.id !== optimisticId),
    }));
    throw error;
  }
},
```

**Ticket:** Create task: "Add optimistic update rollback to store mutations"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Refactor monolithic store into domain-specific slices | HIGH | Architecture |
| Fix race conditions in addVerse and deleteVerse operations | CRITICAL | Data Integrity |
| Add memoized selectors to store to prevent unnecessary re-renders | HIGH | Performance |
| Add Zustand devtools and logging middleware | MEDIUM | Debugging |
| Add error recovery and timeout to store hydration | MEDIUM | Reliability |
| Add constraint to prevent duplicate verse-collection entries | MEDIUM | Quality |
| Refactor useCountUp to use Reanimated API | MEDIUM | Performance |
| Add selective refresh operations to store | MEDIUM | Performance |
| Add store schema versioning and migration system | MEDIUM | Future-Proofing |
| Add optimistic update rollback to store mutations | MEDIUM | Future-Proofing |

---

## Next Review Section
→ Continue with: `BY_LAYER/API-Layer`
