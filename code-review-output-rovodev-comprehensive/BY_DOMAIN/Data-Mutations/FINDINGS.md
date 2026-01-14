[STATUS: review_done_needs_followup]

# Data-Mutations Domain Review

## Summary
The Data-Mutations domain handles core operations like verse deletion, collection deletion, and progress updates. The implementation is relatively clean with proper soft-deletion strategies and junction table usage. However, there are significant concerns around transaction safety, idempotency, error recovery, and the lack of audit logging or undo/redo capabilities.

---

## Critical Issues

### 1. Collection Deletion Not Atomic - Races Between Moves and Delete
**File:** `lib/storage/index.ts` (lines ~169-223)
**Severity:** CRITICAL
**Issue:**
```typescript
// Step 1: Get collection ID
const { data: collection } = await supabase
  .from('user_collections')
  .select('id')
  .eq('client_id', id)
  .is('deleted_at', null)
  .single();

// Step 2: Get verses and move them
const { data: verseLinks } = await supabase
  .from('verse_collections')
  .select('verse_id')
  .eq('collection_id', collection.id);

// Step 3: Upsert to default collection
await supabase
  .from('verse_collections')
  .upsert(newLinks, ...);

// Step 4: Delete junction entries
await supabase
  .from('verse_collections')
  .delete()
  .eq('collection_id', collection.id);

// Step 5: Soft-delete collection
await supabase
  .from('user_collections')
  .update({ deleted_at: ... })
  .eq('id', collection.id);
```
- 5 separate database operations, no transaction wrapper
- If step 3 fails, verses aren't in any collection
- If step 4 fails mid-way, duplicate junction entries
- If step 5 fails, collection appears alive but verses moved
- No rollback if any step fails

**Impact:**
- Verses can become orphaned
- Collection appears deleted but still active
- Data inconsistency corruption
- User data loss

**Suggested Fix:**
```typescript
// Use database transaction or RPC function
export async function deleteCollection(id: string): Promise<void> {
  if (id === DEFAULT_COLLECTION_ID) return;
  
  const { data, error } = await supabase.rpc('delete_collection_safe', {
    p_client_id: id,
    p_default_collection_id: DEFAULT_COLLECTION_ID,
  });
  
  if (error) {
    throw new Error(`Failed to delete collection: ${error.message}`);
  }
}

// In Supabase (PostgreSQL function)
CREATE OR REPLACE FUNCTION delete_collection_safe(
  p_client_id TEXT,
  p_default_collection_id TEXT
) RETURNS void AS $$
BEGIN
  -- All operations in single transaction
  -- 1. Get IDs
  -- 2. Move verses atomically
  -- 3. Delete collection atomically
  -- Either all succeeds or all rolls back
END;
$$ LANGUAGE plpgsql;
```

**Ticket:** Create task: "Implement atomic collection deletion with database transaction"

---

### 2. Verse Deletion Race Condition with Progress Updates
**File:** `lib/storage/index.ts`, `lib/store/index.ts`
**Severity:** CRITICAL
**Issue:**
- `deleteVerse()` removes verse from collection
- But `updateVerseProgress()` still updates the verse
- If user deletes verse while session updates progress:
  - Step 1: User completes hard mode (90% accuracy)
  - Step 2: Verse deletion starts
  - Step 3: Progress update inserts/updates progress
  - Step 4: Verse deletion completes (but progress already updated)
- Soft-deleted verse with progress data still counts as "mastered"

**Impact:**
- Deleted verses appear in mastered list
- Analytics count deleted verses
- User confusion

**Suggested Fix:**
```typescript
// Add check in updateVerseProgress
export async function updateVerseProgress(
  id: string,
  difficulty: Difficulty,
  accuracy: number
): Promise<void> {
  const userId = await getCurrentUserId();
  
  // Check if verse is soft-deleted FIRST
  const { data: verse } = await supabase
    .from('user_verses')
    .select('deleted_at')
    .eq('user_id', userId)
    .eq('client_id', id)
    .single();
  
  if (!verse || verse.deleted_at) {
    console.warn(`[STORAGE] Attempted to update deleted verse: ${id}`);
    return; // Silently skip
  }
  
  // Update only if not deleted
  const { error } = await supabase
    .from('user_verses')
    .update({
      progress: { ...progress, [difficulty]: { bestAccuracy: accuracy, completed: accuracy >= 90 } },
    })
    .eq('user_id', userId)
    .eq('client_id', id)
    .is('deleted_at', null);
  
  if (error) {
    throw new Error('Failed to update progress');
  }
}
```

**Ticket:** Create task: "Add deleted_at check to progress updates"

---

### 3. No Error Recovery for Partially Failed Mutations
**File:** All mutation files
**Severity:** HIGH
**Issue:**
- If any mutation fails, no rollback happens
- No notification to user of failure
- Local state may be inconsistent with server
- User thinks operation succeeded but it didn't

**Impact:**
- Silent data corruption
- User confusion
- Hard to debug issues

**Suggested Fix:**
```typescript
// Wrap mutations with error handling and user feedback
export async function deleteVerseWithRecovery(
  id: string,
  collectionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteVerse(id, collectionId);
    return { success: true };
  } catch (error) {
    console.error('[STORAGE] Delete verse failed:', error);
    
    // Notify user
    return {
      success: false,
      error: 'Failed to delete verse. Please try again.',
    };
  }
}

// In UI
const handleDeleteVerse = async (verseId: string) => {
  setDeleting(true);
  const result = await deleteVerseWithRecovery(verseId, collectionId);
  
  if (!result.success) {
    Alert.alert('Error', result.error || 'Failed to delete verse');
  }
  
  setDeleting(false);
};
```

**Ticket:** Create task: "Add error handling and user feedback to mutations"

---

## Code Quality Issues

### 1. Alignment Logic Has Edge Case Bugs
**File:** `lib/align.ts` (lines ~86-99)
**Severity:** MEDIUM
**Issue:**
```typescript
} else {
  // Equal - words match → correct
  for (let i = 0; i < wordCount; i++) {
    if (expectedIdx < expectedTokens.length) {
      const token = expectedTokens[expectedIdx++];
      alignment.push({
        word: token.raw,
        status: 'correct',
      });
    }
    // Also advance transcribed index to stay in sync
    if (transcribedIdx < transcribedTokens.length) {
      transcribedIdx++;
    }
  }
}
```
- Advances transcribedIdx even if expectedIdx is out of bounds
- Could cause index skew in final tokens
- If word counts don't match exactly, alignment becomes incorrect

**Impact:**
- Alignment scores incorrect
- User's recorded attempts scored wrong

**Suggested Fix:**
```typescript
} else {
  // Equal - words match → correct
  for (let i = 0; i < wordCount; i++) {
    if (expectedIdx >= expectedTokens.length) {
      break; // Stop if we've exhausted expected tokens
    }
    
    const token = expectedTokens[expectedIdx++];
    alignment.push({
      word: token.raw,
      status: 'correct',
    });
    
    // Only advance transcribed if we actually consumed a word
    if (transcribedIdx < transcribedTokens.length) {
      transcribedIdx++;
    }
  }
}
```

**Ticket:** Create task: "Fix alignment index tracking edge cases"

---

### 2. No Validation of Mutation Inputs
**File:** `lib/storage/index.ts`
**Severity:** MEDIUM
**Issue:**
- `updateVerseProgress()` accepts any accuracy value (0-999)
- No validation that difficulty is valid
- No bounds checking on verse references

**Impact:**
- Invalid data in database
- Scoring algorithms break
- Analytics corrupted

**Suggested Fix:**
```typescript
export async function updateVerseProgress(
  id: string,
  difficulty: Difficulty,
  accuracy: number
): Promise<void> {
  // Validate inputs
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error(`Invalid difficulty: ${difficulty}`);
  }
  
  if (accuracy < 0 || accuracy > 100) {
    throw new Error(`Invalid accuracy: ${accuracy} (must be 0-100)`);
  }
  
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid verse id');
  }
  
  // ... rest of implementation
}
```

**Ticket:** Create task: "Add input validation to all mutation functions"

---

### 3. Sync Layer Is Just Wrapper with No Added Value
**File:** `lib/sync/verses.ts`
**Severity:** LOW
**Issue:**
```typescript
export async function syncSaveVerse(...): Promise<SavedVerse> {
  return saveVerse(...); // Just delegates
}
```
- Sync functions are thin wrappers around storage functions
- No actual syncing logic
- Confusing naming (implies sync but just calls storage)
- Deprecated comments suggest these shouldn't exist

**Impact:**
- Code confusion
- Extra abstraction layer
- Hard to understand real sync strategy

**Suggested Fix:**
Remove or rename sync layer:
```typescript
// Option 1: Remove entirely
// Use storage functions directly in store

// Option 2: If future sync is needed, implement real sync
export async function syncSaveVerse(
  verse: SavedVerse,
  collectionId: string
): Promise<{ success: boolean; serverUpdated: boolean }> {
  try {
    // Save locally first
    const saved = await saveVerseLocally(verse, collectionId);
    
    // Then sync to server
    const synced = await syncToServer(saved);
    
    return { success: true, serverUpdated: synced };
  } catch (error) {
    // Handle sync failures
    return { success: false, serverUpdated: false };
  }
}
```

**Ticket:** Create task: "Clarify or remove confusing sync wrapper layer"

---

## Future-Proofing Issues

### 1. No Undo/Redo System
**File:** All mutation files
**Severity:** HIGH
**Issue:**
- User deletes verse by accident → no way to recover
- No undo button or history
- Mutation is permanent immediately

**Impact:**
- Poor UX (users make mistakes)
- User frustration
- Users might avoid destructive operations (conservative use)

**Suggested Fix:**
```typescript
// Implement command pattern for undoable mutations
interface MutationCommand {
  execute: () => Promise<void>;
  undo: () => Promise<void>;
  description: string;
}

export const useUndoRedo = create<{
  history: MutationCommand[];
  currentIndex: number;
  execute: (cmd: MutationCommand) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}>((set, get) => ({
  // Implementation
}));

// Usage
const deleteVerseCommand: MutationCommand = {
  execute: async () => {
    await deleteVerse(verseId, collectionId);
  },
  undo: async () => {
    await restoreVerse(verseId, collectionId);
  },
  description: 'Delete verse',
};

await useUndoRedo.getState().execute(deleteVerseCommand);
```

**Ticket:** Create task: "Implement undo/redo system for mutations"

---

### 2. No Audit Logging
**File:** All mutation files
**Severity:** MEDIUM
**Issue:**
- No record of who changed what when
- Can't trace data corruption source
- No compliance/audit trail for enterprise

**Impact:**
- Hard to debug data issues
- No accountability
- GDPR compliance issues (no access log)

**Suggested Fix:**
```typescript
// Log all mutations
interface AuditLog {
  userId: string;
  action: 'create' | 'update' | 'delete';
  entity: 'verse' | 'collection' | 'progress';
  entityId: string;
  previousValue?: any;
  newValue?: any;
  timestamp: string;
  success: boolean;
}

async function logMutation(log: AuditLog): Promise<void> {
  await supabase.from('audit_logs').insert(log);
}

// Use in mutations
export async function deleteVerse(id: string, collectionId: string): Promise<void> {
  const userId = await getCurrentUserId();
  
  try {
    // Delete implementation
    await supabase.from('verse_collections').delete().eq('verse_id', id);
    
    // Log success
    await logMutation({
      userId,
      action: 'delete',
      entity: 'verse',
      entityId: id,
      timestamp: new Date().toISOString(),
      success: true,
    });
  } catch (error) {
    // Log failure
    await logMutation({
      userId,
      action: 'delete',
      entity: 'verse',
      entityId: id,
      timestamp: new Date().toISOString(),
      success: false,
    });
    throw error;
  }
}
```

**Ticket:** Create task: "Implement audit logging for all mutations"

---

### 3. No Mutation Conflict Resolution
**File:** All mutation files
**Severity:** MEDIUM
**Issue:**
- If two devices make conflicting mutations simultaneously:
  - Device A moves verse to collection X
  - Device B moves same verse to collection Y
- No conflict detection or resolution strategy
- Last write wins (potentially wrong)

**Impact:**
- Data ends up in inconsistent state across devices
- User confusion
- Unpredictable behavior

**Suggested Fix:**
```typescript
// Track mutation versions
interface MutatedEntity {
  id: string;
  version: number;
  lastModified: string;
  lastModifiedBy: string;
}

// Check version before updating
export async function updateVerseCollectionSafe(
  verseId: string,
  collectionId: string,
  expectedVersion: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_verses')
    .update({
      collection_id: collectionId,
      version: expectedVersion + 1,
      last_modified_at: new Date().toISOString(),
    })
    .eq('client_id', verseId)
    .eq('version', expectedVersion); // Only update if version matches
  
  if (error) return false;
  return !!data;
}

// In UI, handle conflict
const success = await updateVerseCollectionSafe(verseId, collectionId, currentVersion);
if (!success) {
  Alert.alert(
    'Conflict',
    'This verse was modified elsewhere. Please refresh and try again.'
  );
}
```

**Ticket:** Create task: "Add optimistic locking for mutation conflict detection"

---

## Performance Issues

### 1. Alignment Algorithm O(n²) Complexity
**File:** `lib/align.ts` (lines ~42-123)
**Severity:** MEDIUM
**Issue:**
- Uses diff algorithm on concatenated words (string diff)
- With long verses (100+ words), diff becomes slow
- Runs synchronously, blocks UI

**Impact:**
- Slow scoring after recording
- UI freeze during alignment
- Poor UX with longer verses

**Suggested Fix:**
```typescript
// Optimize with word-based diff instead of string diff
export function alignTranscriptionOptimized(
  expectedVerse: string,
  cleanedTranscription: string
): AlignmentWord[] {
  const expectedTokens = tokenize(expectedVerse);
  const transcribedTokens = tokenize(cleanedTranscription);
  
  // Use faster token-level diff (custom implementation)
  const alignment = computeTokenAlignment(expectedTokens, transcribedTokens);
  
  return alignment;
}

// O(n) implementation using longest common subsequence
function computeTokenAlignment(expected: Token[], transcribed: Token[]): AlignmentWord[] {
  const lcs = getLongestCommonSubsequence(
    expected.map(t => t.normalized),
    transcribed.map(t => t.normalized)
  );
  
  // Mark tokens as correct/missing/added based on LCS
  // ...
}
```

**Ticket:** Create task: "Optimize alignment algorithm to O(n) complexity"

---

## Scale Issues

### 1. No Batch Delete/Move Operations
**File:** All mutation files
**Severity:** MEDIUM
**Issue:**
- Only supports deleting/moving one verse at a time
- With 100+ verses, user must click 100+ times
- No bulk operations

**Impact:**
- Poor UX with large collections
- Many API calls
- Database load increases

**Suggested Fix:**
```typescript
// Support batch operations
export async function deleteVersesBatch(verseIds: string[]): Promise<void> {
  if (verseIds.length === 0) return;
  
  const userId = await getCurrentUserId();
  
  // Soft-delete all verses in single operation
  const { error } = await supabase
    .from('user_verses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('client_id', verseIds);
  
  if (error) throw error;
}

// Usage in UI
const handleBulkDelete = async (selectedVerseIds: string[]) => {
  await deleteVersesBatch(selectedVerseIds);
  // Refresh UI
};
```

**Ticket:** Create task: "Implement batch mutation operations"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Implement atomic collection deletion with database transaction | CRITICAL | Data Integrity |
| Add deleted_at check to progress updates | CRITICAL | Data Integrity |
| Add error handling and user feedback to mutations | HIGH | Error Handling |
| Fix alignment index tracking edge cases | MEDIUM | Quality |
| Add input validation to all mutation functions | MEDIUM | Quality |
| Clarify or remove confusing sync wrapper layer | LOW | Code Quality |
| Implement undo/redo system for mutations | HIGH | Future-Proofing |
| Implement audit logging for all mutations | MEDIUM | Future-Proofing |
| Add optimistic locking for mutation conflict detection | MEDIUM | Future-Proofing |
| Optimize alignment algorithm to O(n) complexity | MEDIUM | Performance |
| Implement batch mutation operations | MEDIUM | Scale |

---

## Next Review Section
→ Continue with: `BY_LAYER/*` (9 layers)
