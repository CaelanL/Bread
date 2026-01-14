[STATUS: review_done_needs_followup]

# Storage Layer Review

## Summary
The Storage layer provides AsyncStorage abstraction for local persistence and Supabase for remote storage. The implementation is straightforward but lacks error handling, validation, and proper cleanup semantics. Missing are data encryption, quota management, and recovery from corrupted local state.

---

## Critical Issues

### 1. No Local Storage Corruption Recovery
**File:** `lib/storage/index.ts`
**Severity:** HIGH
**Issue:**
- If AsyncStorage corrupted, app can't recover
- No validation of stored data structure
- No schema versioning for AsyncStorage
- Corrupted data causes app to crash on load

**Impact:**
- Unrecoverable app state
- User can't use app until reinstall
- User data loss

**Suggested Fix:**
```typescript
// Add storage validation and recovery
export async function loadFromStorage<T>(key: string, schema: z.ZodSchema<T>): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    
    const parsed = JSON.parse(raw);
    
    // Validate against schema
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      console.warn(`[STORAGE] Invalid data for ${key}:`, validated.error);
      // Try to recover with defaults
      return null;
    }
    
    return validated.data;
  } catch (error) {
    console.error(`[STORAGE] Failed to load ${key}:`, error);
    // Don't throw, allow app to continue with defaults
    return null;
  }
}

// Usage
const collectionsSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
}));

const collections = await loadFromStorage('collections', collectionsSchema);
```

**Ticket:** Create task: "Add storage validation and recovery with schema validation"

---

### 2. No Quota Management for Local Storage
**File:** `lib/storage/index.ts`
**Severity:** MEDIUM
**Issue:**
- Could store unlimited data locally
- AsyncStorage has size limit (~10MB on mobile)
- No cleanup when quota exceeded
- App crashes when quota exceeded

**Impact:**
- Unexpected app crash
- User data loss
- Poor UX

**Suggested Fix:**
```typescript
// Add quota management
const STORAGE_QUOTA = 8 * 1024 * 1024; // 8MB limit

export async function saveToStorageWithQuota(key: string, value: any): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    const size = new Blob([serialized]).size;
    
    // Estimate current usage
    const allKeys = await AsyncStorage.getAllKeys();
    let currentSize = 0;
    for (const k of allKeys) {
      const item = await AsyncStorage.getItem(k);
      if (item) {
        currentSize += new Blob([item]).size;
      }
    }
    
    // Check if we have space
    if (currentSize + size > STORAGE_QUOTA) {
      console.warn('[STORAGE] Quota exceeded, cleaning up old data');
      // Implement cleanup strategy (LRU, remove cache, etc)
      await cleanupOldData();
      
      // Retry
      const retried = await saveToStorageWithQuota(key, value);
      if (!retried) {
        return false;
      }
    }
    
    await AsyncStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.error('[STORAGE] Failed to save:', error);
    return false;
  }
}
```

**Ticket:** Create task: "Add local storage quota management and cleanup"

---

### 3. No Data Encryption for Sensitive Data
**File:** `lib/storage/index.ts`
**Severity:** HIGH
**Issue:**
- User auth tokens stored plaintext in AsyncStorage
- Sensitive user data unencrypted
- Vulnerable if device compromised

**Impact:**
- Security vulnerability
- User account takeover risk
- Data breach

**Suggested Fix:**
```typescript
// Add encryption
import { secretbox } from 'https://deno.land/x/nacl/secretbox.ts';

export async function saveEncrypted(key: string, value: any, password: string): Promise<void> {
  const json = JSON.stringify(value);
  const encoder = new TextEncoder();
  
  // Derive key from password
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const keyBits = await crypto.subtle.deriveBits('PBKDF2', keyMaterial, 256);
  const keyData = new Uint8Array(keyBits);
  
  // Encrypt
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const encrypted = secretbox(encoder.encode(json), nonce, keyData);
  
  // Store nonce + ciphertext
  const stored = JSON.stringify({
    nonce: Array.from(nonce),
    ciphertext: Array.from(encrypted),
  });
  
  await AsyncStorage.setItem(key, stored);
}

export async function loadEncrypted(key: string, password: string): Promise<any> {
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return null;
  
  const { nonce, ciphertext } = JSON.parse(stored);
  const encoder = new TextEncoder();
  
  // Derive key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const keyBits = await crypto.subtle.deriveBits('PBKDF2', keyMaterial, 256);
  const keyData = new Uint8Array(keyBits);
  
  // Decrypt
  const decrypted = secretbox.open(
    new Uint8Array(ciphertext),
    new Uint8Array(nonce),
    keyData
  );
  
  if (!decrypted) throw new Error('Decryption failed');
  
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}
```

**Ticket:** Create task: "Add encryption for sensitive data in local storage"

---

## Code Quality Issues

### 1. No Validation on Supabase Responses
**File:** `lib/storage/index.ts` (all queries)
**Severity:** MEDIUM
**Issue:**
- Assumes Supabase returns expected structure
- No validation of response format
- No null checks on nested properties
- Runtime errors if response unexpected

**Impact:**
- Silent failures
- App crashes on unexpected response
- Hard to debug

**Suggested Fix:**
```typescript
// Add response validation
const verseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  book: z.string(),
  chapter: z.number(),
  verse_start: z.number(),
  verse_end: z.number(),
  version: z.enum(['ESV', 'NLT', 'KJV']),
  deleted_at: z.string().nullable(),
});

export async function fetchVerse(id: string): Promise<Verse> {
  const { data, error } = await supabase
    .from('user_verses')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) throw error;
  
  // Validate response
  const validated = verseSchema.safeParse(data);
  if (!validated.success) {
    throw new Error(`Invalid verse data: ${validated.error}`);
  }
  
  return validated.data;
}
```

**Ticket:** Create task: "Add validation for all Supabase responses"

---

## Performance Issues

### 1. No Batching for AsyncStorage Operations
**File:** `lib/storage/index.ts`
**Severity:** MEDIUM
**Issue:**
```typescript
// Individual operations for each item
for (const verse of verses) {
  await AsyncStorage.setItem(`verse-${verse.id}`, JSON.stringify(verse));
}
```
- Individual reads/writes are slow
- Cumulative performance bad with many items

**Impact:**
- Slow local persistence
- UI blocking during batch saves
- Poor mobile performance

**Suggested Fix:**
```typescript
// Batch operations
export async function saveMultipleToStorage(items: { key: string; value: any }[]): Promise<void> {
  const serialized = items.map(({ key, value }) => [key, JSON.stringify(value)]);
  await AsyncStorage.multiSet(serialized);
}

// Usage
await saveMultipleToStorage(
  verses.map(v => ({ key: `verse-${v.id}`, value: v }))
);
```

**Ticket:** Create task: "Use AsyncStorage batch operations for performance"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add storage validation and recovery with schema validation | HIGH | Reliability |
| Add local storage quota management and cleanup | MEDIUM | Reliability |
| Add encryption for sensitive data in local storage | HIGH | Security |
| Add validation for all Supabase responses | MEDIUM | Quality |
| Use AsyncStorage batch operations for performance | MEDIUM | Performance |

---

## Next Review Section
→ Continue with: `BY_LAYER/Database-Schema`
