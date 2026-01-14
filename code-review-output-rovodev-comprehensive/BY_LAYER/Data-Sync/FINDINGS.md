[STATUS: review_done_needs_followup]

# Data-Sync Layer Review

## Summary
The Data-Sync layer handles local-to-server synchronization with migration logic and collection/verse syncing. The architecture recognizes the need for sync, but implementation is incomplete with no real conflict resolution, missing idempotency, and incomplete error recovery.

---

## Critical Issues

### 1. Migration Not Idempotent
**File:** `lib/sync/migration.ts`
**Severity:** CRITICAL
**Issue:**
- If migration interrupted mid-way, can't safely re-run
- Rerunning creates duplicates
- No transaction wrapping entire migration
- No rollback on partial failure

**Impact:**
- Duplicate data in database
- Inconsistent state
- Data corruption

**Suggested Fix:**
```typescript
// Add idempotency
export async function migrateLocalDataToServer(): Promise<{ success: boolean; error?: string }> {
  const MIGRATION_ID = 'v1-migration-' + Date.now();
  
  // Check if migration already completed
  const migrationCompleted = await AsyncStorage.getItem('migration_completed');
  if (migrationCompleted === 'true') {
    console.log('[SYNC] Migration already completed');
    return { success: true };
  }
  
  // Check if migration in progress (crash recovery)
  const inProgressId = await AsyncStorage.getItem('migration_in_progress');
  if (inProgressId) {
    console.log('[SYNC] Migration in progress, continuing from', inProgressId);
    // Resume from checkpoint
  }
  
  try {
    // Mark in progress
    await AsyncStorage.setItem('migration_in_progress', MIGRATION_ID);
    
    // Perform migration in transaction
    const result = await supabase.rpc('migrate_user_data');
    
    // Only mark complete if successful
    await AsyncStorage.setItem('migration_completed', 'true');
    await AsyncStorage.removeItem('migration_in_progress');
    
    return { success: true };
  } catch (error) {
    console.error('[SYNC] Migration failed:', error);
    // Keep migration_in_progress set to allow retry
    return { success: false, error: error.message };
  }
}
```

**Ticket:** Create task: "Make migration idempotent with checkpoint recovery"

---

### 2. No Conflict Resolution Strategy
**File:** `lib/sync/collections.ts`, `verses.ts`
**Severity:** HIGH
**Issue:**
- Two devices edit same collection simultaneously
- Device A: changes name to "OT Study"
- Device B: changes name to "Old Testament"
- No mechanism to resolve conflict
- One change overwrites the other silently

**Impact:**
- User changes lost
- Data inconsistency
- Unpredictable behavior

**Suggested Fix:**
```typescript
// Implement conflict resolution
type ConflictResolutionStrategy = 'last-write-wins' | 'client-wins' | 'server-wins' | 'manual';

interface SyncMetadata {
  version: number;
  lastModified: string;
  lastModifiedBy: string;
}

export async function syncCollection(
  collection: Collection & SyncMetadata,
  strategy: ConflictResolutionStrategy = 'last-write-wins'
): Promise<{ success: boolean; conflict?: boolean; resolution?: Collection }> {
  // Get server version
  const { data: serverVersion } = await supabase
    .from('user_collections')
    .select('*')
    .eq('id', collection.id)
    .single();
  
  if (!serverVersion) {
    // Collection doesn't exist on server, create it
    return createCollection(collection);
  }
  
  // Check for conflict
  if (serverVersion.version !== collection.version) {
    console.warn('[SYNC] Conflict detected for collection', collection.id);
    
    switch (strategy) {
      case 'last-write-wins':
        // Compare timestamps, use newer
        const clientTime = new Date(collection.lastModified);
        const serverTime = new Date(serverVersion.last_modified);
        const winner = clientTime > serverTime ? collection : serverVersion;
        return { success: true, conflict: true, resolution: winner };
      
      case 'client-wins':
        // Use client version
        return { success: true, conflict: true, resolution: collection };
      
      case 'manual':
        // Return conflict for UI to resolve
        return { success: false, conflict: true, resolution: serverVersion };
    }
  }
  
  // No conflict, update
  return { success: true };
}
```

**Ticket:** Create task: "Implement conflict resolution strategy for concurrent sync"

---

### 3. No Offline Queue
**File:** All sync files
**Severity:** HIGH
**Issue:**
- If user offline, changes are lost
- No local queue of pending operations
- User thinks changes saved but they're not
- No retry when connection restored

**Impact:**
- User data loss
- User frustration
- Silent failures

**Suggested Fix:**
```typescript
// Add offline queue
interface PendingOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'collection' | 'verse';
  data: any;
  timestamp: number;
  retries: number;
}

export class OfflineQueue {
  private queue: PendingOperation[] = [];
  
  async enqueue(op: PendingOperation): Promise<void> {
    this.queue.push(op);
    await this.persist();
  }
  
  async sync(): Promise<void> {
    for (const op of this.queue) {
      try {
        await this.executeOperation(op);
        this.queue = this.queue.filter(o => o.id !== op.id);
      } catch (error) {
        if (op.retries < 3) {
          op.retries++;
        } else {
          console.error('[SYNC] Operation failed after retries:', op);
        }
      }
    }
    await this.persist();
  }
  
  private async persist(): Promise<void> {
    await AsyncStorage.setItem('offline_queue', JSON.stringify(this.queue));
  }
}

// Use in app
const offlineQueue = new OfflineQueue();

// On network change
onNetworkStateChange((isOnline) => {
  if (isOnline) {
    offlineQueue.sync();
  }
});
```

**Ticket:** Create task: "Implement offline queue for pending operations"

---

## Code Quality Issues

### 1. Sync Layer Is Just Thin Wrapper
**File:** `lib/sync/verses.ts`, `collections.ts`
**Severity:** MEDIUM
**Issue:**
```typescript
export async function syncSaveCollection(collection: Collection) {
  return saveCollection(collection); // Just delegates!
}
```
- Sync functions just call storage functions
- No actual syncing logic
- Confusing naming
- Should be removed or implemented

**Impact:**
- Code confusion
- Extra abstraction layer
- Harder to understand real flow

**Suggested Fix:**
Remove or rename with real sync logic.

**Ticket:** Create task: "Remove or implement real sync logic in sync layer"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Make migration idempotent with checkpoint recovery | CRITICAL | Data Integrity |
| Implement conflict resolution strategy for concurrent sync | HIGH | Reliability |
| Implement offline queue for pending operations | HIGH | Reliability |
| Remove or implement real sync logic in sync layer | MEDIUM | Quality |

---

## Next Review Section
→ Continue with: `BY_LAYER/Storage`
