# Data-Sync Layer - Code Review

**[STATUS: review_done_needs_followup]**

**Reviewer**: Rovo Dev (AI Agent)  
**Review Date**: 2026-01-13  
**Focus**: Scale & Performance

---

## Executive Summary

Data sync handles local↔server synchronization and migrations. **Assessment: Good foundation, but has N+1 queries, no error recovery, and migration not resumable.**

**Key Issues Found:**
- 🔴 **Critical**: Migration not resumable (crashes mid-way = data loss risk)
- 🟠 **High**: N+1 queries in migration (queries per verse)
- 🟠 **High**: No conflict resolution strategy
- 🟡 **Medium**: Silent failures in migration loop
- 🟡 **Medium**: Sync functions duplicate logic from storage

---

## Detailed Findings

### 1. 🔴 CRITICAL: Migration Not Resumable

**Issue** (Lines 34-147): If migration crashes mid-way, flag never resets on retry.

```typescript
export async function migrateLocalDataToServer(): Promise<void> {
  const isComplete = await isMigrationComplete();
  if (isComplete) return;  // ← Exits if ANY migration started before
  
  try {
    // Migration logic...
    // If crash happens here on verse 500/1000...
    await markMigrationComplete();  // ← Only marked at END
  } catch (e) {
    console.error('[MIGRATION] Migration failed:', e);
    throw e;  // ← Flag NOT reset, migration won't retry!
  }
}
```

**Problem:**
- User syncs 1000 verses, crashes on verse 500
- Next app start: sees flag = true, skips migration
- **Result**: 500 verses never synced, data lost

**Recommended Fix:**
```typescript
// Track migration progress per batch
async function migrateLocalDataToServer(): Promise<void> {
  const progressKey = 'migration_progress';
  let progress = await getMigrationProgress();
  
  try {
    // Skip already-migrated collections
    const collections = await getCollections();
    for (let i = progress.collectionIndex; i < collections.length; i++) {
      await syncCollection(collections[i]);
      progress.collectionIndex = i;
      await saveMigrationProgress(progress);
    }
    
    // Skip already-migrated verses
    const verses = await getSavedVerses();
    for (let i = progress.verseIndex; i < verses.length; i++) {
      await syncVerse(verses[i]);
      progress.verseIndex = i;
      await saveMigrationProgress(progress);
    }
    
    await markMigrationComplete();
  } catch (e) {
    // Keep progress, let next attempt resume
    throw e;
  }
}
```

---

### 2. 🟠 HIGH: N+1 Queries in Migration

**Issue** (Lines 96-139): For each verse, query to check if exists, then insert/update.

```typescript
for (const verse of verses) {  // 1000 verses = 1000+ queries
  const { data: existing } = await supabase
    .from('user_verses')
    .select('id')
    .eq('client_id', verse.id)
    .single();  // Query #1

  if (existing) {
    await supabase
      .from('user_verses')
      .update({ progress: verse.progress })
      .eq('client_id', verse.id);  // Query #2
    continue;
  }

  const { error } = await supabase.from('user_verses').insert({...});  // Query #3
}
```

**Problem:**
- 1000 verses × 2-3 queries = 2-3000 database queries
- Migration takes minutes instead of seconds
- Huge API quota usage

**Recommended Fix:**
Use `upsert` for atomic operation:

```typescript
const verseInserts = verses.map(verse => ({
  user_id: userId,
  client_id: verse.id,
  book: verse.book,
  // ... all fields
}));

// Single batch operation
await supabase.from('user_verses').upsert(verseInserts, {
  onConflict: 'client_id',
  ignoreDuplicates: false,  // Update if exists
});
```

---

### 3. 🟠 HIGH: No Conflict Resolution Strategy

**Issue**: If verse exists on both client and server with different progress, which wins?

```typescript
if (existing) {
  // Update progress if verse exists
  await supabase
    .from('user_verses')
    .update({ progress: verse.progress })
    .eq('client_id', verse.id);  // ← Always use local version!
}
```

**Problem:**
- Client: verse mastered 1 month ago
- Server (from another device): verse deleted yesterday
- Migration: overwrites server deletion with client's mastered state
- **Result**: Data corruption

**Recommended Fix:**
```typescript
// Compare timestamps, use newer version
const { data: serverVerse } = await supabase
  .from('user_verses')
  .select('progress, updated_at')
  .eq('client_id', verse.id)
  .single();

if (serverVerse) {
  const clientTime = new Date(verse.updatedAt).getTime();
  const serverTime = new Date(serverVerse.updated_at).getTime();
  
  if (clientTime > serverTime) {
    // Client is newer, update server
    await updateVerse(verse);
  }
  // Otherwise keep server version
}
```

---

### 4. 🟡 MEDIUM: Silent Failures in Migration Loop

**Issue** (Lines 72-86, 133-136): Errors are logged but migration continues.

```typescript
if (error) {
  console.error(`[MIGRATION] Failed to sync collection ${collection.id}:`, error);
  // Don't throw, just continue!
  continue;
}

if (error) {
  console.error(`[MIGRATION] Failed to sync verse ${verse.id}:`, error);
  // Don't throw, just continue!
  continue;
}
```

**Problem:**
- User doesn't know migration failed partially
- Some verses never synced, silently
- No retry mechanism
- User thinks migration complete but data missing

**Recommended Fix:**
```typescript
const failures = [];

for (const verse of verses) {
  try {
    await syncVerse(verse);
  } catch (e) {
    failures.push({ verse: verse.id, error: e });
  }
}

if (failures.length > 0) {
  console.error(`[MIGRATION] ${failures.length} verses failed to sync`);
  throw new Error(`Migration incomplete: ${failures.length} items failed`);
}
```

---

### 5. 🟡 MEDIUM: Sync Functions Duplicate Storage Logic

**Issue** (Lines 28-30): Sync functions are thin wrappers.

```typescript
export async function syncCreateCollection(name: string): Promise<Collection> {
  return createCollection(name);  // ← Just delegates!
}

export async function syncDeleteCollection(id: string): Promise<void> {
  return deleteCollection(id);  // ← Just delegates!
}
```

**Problem:**
- Code duplication without benefit
- Confusing API (two ways to do same thing)
- Hard to maintain

**Recommended Fix:**
Remove sync layer if just wrapping storage:

```typescript
// storage/index.ts exports these directly
export { createCollection, deleteCollection, getCollections };

// OR if sync logic is needed, make it actual sync:
export async function syncCreateCollection(name: string): Promise<Collection> {
  const local = await createCollection(name);
  
  // Actually sync to server
  await supabase.from('user_collections').insert({
    // Use local data to create server entry
  });
  
  return local;
}
```

---

## Tickets to Create

- [ ] **TICKET-038**: Make migration resumable with progress tracking (Critical)
- [ ] **TICKET-039**: Use upsert for batch sync (High)
- [ ] **TICKET-040**: Add conflict resolution strategy (High)
- [ ] **TICKET-041**: Handle migration failures properly (Medium)
- [ ] **TICKET-042**: Remove duplicate sync wrappers (Medium)

---

**Estimated effort**: 2-3 days  
**Estimated improvement**: 100x faster migration, no data loss
