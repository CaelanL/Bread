[STATUS: review_done_needs_followup]

# Bible-Data Domain Review

## Summary
The Bible-Data domain has a well-designed adapter pattern for supporting multiple Bible versions with intelligent caching and normalization. However, there are critical concerns around cache invalidation, error handling edge cases, API quota management, and adapter implementation consistency. The ESV adapter has good error handling but other adapters may not.

---

## Critical Issues

### 1. No Cache Invalidation Strategy
**File:** `supabase/functions/bible/cache.ts`
**Severity:** CRITICAL
**Issue:**
- Verses cached indefinitely with no TTL (time-to-live)
- If Bible API updates their text, app serves stale data indefinitely
- LRU eviction only when storage limit hit, not time-based
- No way to purge cache if corruption detected
- Users never see corrections or updates from publishers

**Impact:**
- App displays outdated Bible text for months
- User confusion if they notice discrepancies
- No mechanism to fix errors once cached
- Legal/licensing issues if Bible publisher updates verses but app still serves old version

**Suggested Fix:**
```typescript
// Add TTL to cache
interface VerseCacheEntry {
  verse: number;
  text: string;
  version: string;
  last_used_at: string;
  cached_at: string; // New field
}

const CACHE_TTL_DAYS = 90; // Re-fetch every 90 days

export async function getCachedVerse(
  book: string,
  chapter: number,
  verse: number,
  version: string
): Promise<string | null> {
  const admin = getAdminClient();
  
  const { data } = await admin
    .from("verse_cache")
    .select("text, cached_at")
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("verse", verse)
    .eq("version", version)
    .single();
  
  if (!data) return null;
  
  // Check if cache is stale
  const cachedAt = new Date(data.cached_at);
  const now = new Date();
  const daysSinceCached = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSinceCached > CACHE_TTL_DAYS) {
    console.log(`Cache expired for ${book} ${chapter}:${verse} (${daysSinceCached} days old)`);
    return null; // Force re-fetch
  }
  
  return data.text;
}
```

**Ticket:** Create task: "Add TTL-based cache invalidation for Bible verses"

---

### 2. Verse Count Mismatch Not Handled
**File:** `supabase/functions/bible/adapters/esv.ts` (lines ~47-51)
**Severity:** HIGH
**Issue:**
```typescript
if (actualCount !== expectedCount && expectedCount > 0) {
  console.warn(
    `ESV verse count: expected ${expectedCount}, got ${actualCount}`
  );
  // ← Just warns, continues anyway
}
```
- If expected vs actual verse count doesn't match, just logs warning
- Returns potentially incomplete or over-complete chapter
- No retry or error recovery
- Downstream code assumes complete chapter

**Impact:**
- Silently incorrect data in cache
- User studies with wrong verse boundaries
- Scoring/alignment logic breaks
- Session data becomes corrupt

**Suggested Fix:**
```typescript
if (actualCount !== expectedCount && expectedCount > 0) {
  // Only allow ±1 variance (some versions have alternate verses)
  const variance = Math.abs(actualCount - expectedCount);
  
  if (variance > 1) {
    console.error(
      `[ESV] VERSE COUNT MISMATCH: expected ${expectedCount}, got ${actualCount} for ${ref}`
    );
    
    // Option 1: Throw error and don't cache incomplete data
    throw new Error(
      `ESV returned ${actualCount} verses but expected ${expectedCount} for ${ref}. ` +
      `This may indicate a parsing error or API issue.`
    );
  } else if (variance === 1) {
    // Single verse variance - log but allow (some versions have optional verses)
    console.warn(
      `[ESV] VERSE COUNT: expected ${expectedCount}, got ${actualCount} for ${ref} (1 verse variance allowed)`
    );
  }
}

return verses;
```

**Ticket:** Create task: "Add strict verse count validation with error handling"

---

### 3. No Rate Limiting Coordination Between Frontend and Backend
**File:** `lib/api/bible.ts`, `supabase/functions/bible/index.ts`
**Severity:** HIGH
**Issue:**
- Frontend calls `fetchVerse()` which calls backend API
- Backend increments usage counter
- But frontend doesn't know the quota before calling
- Frontend could rapidly call before getting 429 response
- No queue or batching mechanism
- Rate limiting only enforced after limit exceeded

**Impact:**
- Requests silently fail
- User can't add verses during quota time
- Poor UX (user doesn't know why requests fail)
- Batch operations impossible

**Suggested Fix:**
```typescript
// Frontend should check quota first
export async function checkBibleQuota(): Promise<{
  remaining: number;
  limit: number;
  resetsAt: string;
} | null> {
  try {
    const token = await getAuthToken();
    const baseUrl = getSupabaseUrl();
    
    const response = await fetch(`${baseUrl}/functions/v1/bible-quota`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error('[BIBLE] Failed to check quota:', error);
    return null;
  }
}

// In UI, check quota before allowing verse add
const handleAddVerse = async () => {
  const quota = await checkBibleQuota();
  
  if (!quota || quota.remaining === 0) {
    Alert.alert(
      'Daily Limit Reached',
      `You've reached your daily Bible verse limit. Please try again tomorrow at ${quota?.resetsAt}`
    );
    return;
  }
  
  // Proceed with adding verse
};
```

**Ticket:** Create task: "Add client-side quota checking before Bible API calls"

---

## Code Quality Issues

### 1. Incomplete NLT and KJV Adapter Implementation
**File:** `supabase/functions/bible/adapters/nlt.ts`, `kjv.ts`
**Severity:** HIGH
**Issue:**
- ESV adapter is complete with detailed parsing
- NLT and KJV adapters not examined but likely incomplete
- No validation that they parse correctly
- Different error handling between adapters

**Impact:**
- NLT/KJV fetches may silently fail or return wrong data
- Users can't reliably use other versions
- Adapter pattern breaks down

**Suggested Fix:**
Ensure all adapters have:
```typescript
// Consistent error handling
try {
  const response = await fetch(...);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.passages?.[0]) throw new Error('No passages in response');
  return { verses: parseChapter(data.passages[0], expectedCount) };
} catch (error) {
  console.error(`[${this.id}] Failed to fetch ${ref}:`, error);
  throw new Error(`${this.name} adapter failed: ${error.message}`);
}
```

**Ticket:** Create task: "Validate and standardize NLT and KJV adapter implementations"

---

### 2. Parse Errors Not Distinguishable from Network Errors
**File:** `supabase/functions/bible/adapters/esv.ts` (line 44)
**Severity:** MEDIUM
**Issue:**
```typescript
if (actualCount === 0) {
  console.error("=== ESV PARSE FAILURE ===");
  console.error("No verses found. Raw text:", text.substring(0, 2000));
  throw new Error("ESV parsing failed: no verses extracted");
}
```
- Parse error throws same as network error
- Client code can't distinguish between:
  - API returned wrong format (bug)
  - Network problem (transient, retry)
  - Invalid reference (permanent, don't retry)

**Impact:**
- Frontend can't implement smart retry logic
- No way to report parse errors to admins
- User doesn't know if they should retry

**Suggested Fix:**
```typescript
class BibleAdapterError extends Error {
  constructor(
    public type: 'parse' | 'network' | 'validation' | 'not_found' | 'auth',
    message: string
  ) {
    super(message);
    this.name = 'BibleAdapterError';
  }
}

if (actualCount === 0) {
  throw new BibleAdapterError(
    'parse',
    `ESV parsing failed: no verses extracted from response`
  );
}

// In backend main handler
try {
  const result = await adapter.fetchChapter(ref, version, expectedCount);
  return jsonResponse({ verses: result.verses });
} catch (error) {
  if (error instanceof BibleAdapterError) {
    if (error.type === 'not_found') {
      return jsonResponse({ error: 'Reference not found' }, { status: 404 });
    } else if (error.type === 'parse') {
      return jsonResponse({ error: 'Bible service returned invalid data' }, { status: 502 });
    }
  }
  throw error;
}
```

**Ticket:** Create task: "Add typed Bible adapter errors for better error handling"

---

### 3. No Validation of Reference Format Before API Call
**File:** `supabase/functions/bible/index.ts` (lines ~109-115)
**Severity:** MEDIUM
**Issue:**
```typescript
const ref = normalizeReference(rawRef);
const parsed = parseReference(ref);
if (!parsed) {
  return badRequest(`Invalid reference format: ${ref}`);
}
// But still calls adapter even if parsed is null-like
```
- Reference validation is done but could be more thorough
- No bounds checking (verse 9999, chapter 500, etc.)
- Adapter receives potentially invalid parsed object

**Impact:**
- API calls with invalid references waste quota
- Adapters may crash or return wrong data
- Unnecessary external API calls

**Suggested Fix:**
```typescript
function validateReference(parsed: ParsedRef): { valid: boolean; error?: string } {
  if (!parsed.book || !parsed.chapter) {
    return { valid: false, error: 'Missing book or chapter' };
  }
  
  if (parsed.chapter < 1 || parsed.chapter > 200) {
    return { valid: false, error: 'Chapter out of range (1-200)' };
  }
  
  if (parsed.verse && (parsed.verse < 1 || parsed.verse > 999)) {
    return { valid: false, error: 'Verse out of range (1-999)' };
  }
  
  if (parsed.verseEnd && parsed.verseEnd < parsed.verse) {
    return { valid: false, error: 'Verse end before verse start' };
  }
  
  // Check if book exists
  const structure = getBookStructure(parsed.book);
  if (!structure) {
    return { valid: false, error: `Unknown book: ${parsed.book}` };
  }
  
  if (parsed.chapter > structure.chapters.length) {
    return { valid: false, error: `${parsed.book} only has ${structure.chapters.length} chapters` };
  }
  
  return { valid: true };
}

const validation = validateReference(parsed);
if (!validation.valid) {
  return badRequest(`Invalid reference: ${validation.error}`);
}
```

**Ticket:** Create task: "Add comprehensive reference validation before API calls"

---

### 4. Session Cache Not Cleaned Up
**File:** `lib/api/bible.ts`, `lib/cache/session-cache.ts`
**Severity:** MEDIUM
**Issue:**
- Session cache stored in memory with no limit
- If user fetches hundreds of verses, cache grows indefinitely
- No cleanup on app exit or logout
- Could cause memory leaks

**Impact:**
- Memory usage grows over time
- Mobile app performance degrades
- Eventual crash with OOM error

**Suggested Fix:**
```typescript
// Add size limits and cleanup
const SESSION_CACHE_MAX_VERSES = 500;
const SESSION_CACHE_MAX_MEMORY_MB = 50;

export function clearSessionCache(): void {
  verseCache.clear();
  chapterCache.clear();
  console.log('[SESSION_CACHE] Cleared');
}

// Cleanup on logout
useEffect(() => {
  const unsubscribe = useAuth().onAuthStateChange((session) => {
    if (!session) {
      clearSessionCache();
    }
  });
  
  return unsubscribe;
}, []);

// Cleanup when user navigates away
useEffect(() => {
  return () => {
    clearSessionCache();
  };
}, []);
```

**Ticket:** Create task: "Add session cache size limits and cleanup"

---

## Future-Proofing Issues

### 1. No Support for Multiple Versions Simultaneously
**File:** All Bible files
**Severity:** HIGH
**Issue:**
- Can only use one version at a time (selected in settings)
- Switching versions requires UI change
- Can't compare verses across versions
- Can't support users with different preferences in same session

**Impact:**
- Limited feature set vs competitors
- Can't build features like "compare translations"
- User experience limited

**Suggested Fix:**
Design for multi-version support:
```typescript
// Store verses with version context
interface VerseWithVersion {
  text: string;
  version: BibleVersion;
}

// Support querying multiple versions
export async function fetchVerseMultiVersion(
  reference: string,
  versions: BibleVersion[]
): Promise<Record<BibleVersion, string>> {
  const results: Record<BibleVersion, string> = {};
  
  for (const version of versions) {
    try {
      const verse = await fetchVerse(reference, version);
      results[version] = verse.text;
    } catch (error) {
      console.warn(`Failed to fetch ${reference} in ${version}:`, error);
    }
  }
  
  return results;
}
```

**Ticket:** Create task: "Design multi-version support architecture"

---

### 2. No Bible Commentary or Cross-References
**File:** All Bible files
**Severity:** MEDIUM
**Issue:**
- Only fetches plain verse text
- No commentary, footnotes, or cross-references
- Limited scholarly features

**Impact:**
- Limited study capabilities
- Can't compete with features of other Bible apps

**Suggested Fix:**
Design extensible metadata:
```typescript
interface VerseMetadata {
  footnotes?: FootnoteReference[];
  crossReferences?: string[]; // ["Romans 6:23", "John 3:16"]
  commentary?: CommentarySection[];
  meanings?: WordMeaning[];
}

// Fetch verse with metadata
export async function fetchVerseWithMetadata(
  reference: string,
  version: BibleVersion,
  includeMetadata: string[] = ['footnotes']
): Promise<BibleVerse & VerseMetadata> {
  // Implementation
}
```

**Ticket:** Create task: "Design Bible metadata and commentary system"

---

### 3. No Support for Audio Bible Versions
**File:** All Bible files
**Severity:** MEDIUM
**Issue:**
- Only text-based
- No audio playback
- Can't support audio memorization

**Impact:**
- Limited accessibility
- Missing feature for multi-modal learners
- Can't compete with full-featured Bible apps

**Suggested Fix:**
```typescript
interface BibleVersion {
  id: string;
  name: string;
  type: 'text' | 'audio' | 'video';
  format?: 'mp3' | 'wav' | 'aac';
  audioUrl?: string; // For audio versions
}

// Fetch audio verse
export async function fetchVerseAudio(
  reference: string,
  version: BibleVersion
): Promise<AudioData> {
  if (version.type !== 'audio') {
    throw new Error(`Version ${version.id} is not an audio version`);
  }
  
  return fetchAudio(version.audioUrl || '', reference);
}
```

**Ticket:** Create task: "Design audio Bible version support"

---

## Performance Issues

### 1. LRU Eviction Query Not Optimized
**File:** `supabase/functions/bible/cache.ts` (lines ~80-99)
**Severity:** MEDIUM
**Issue:**
```typescript
// Check current count for this version
const { count } = await admin
  .from("verse_cache")
  .select("*", { count: "exact", head: true })
  .eq("version", version);

// Check existing count again
const { count: existingCount } = await admin
  .from("verse_cache")
  .select("*", { count: "exact", head: true })
  .eq("book", book)
  .eq("chapter", chapter)
  .eq("version", version)
  .in("verse", verseNums);
```
- Makes separate queries to count verses
- Could be single query with aggregation
- Heavy load when many verses cached

**Impact:**
- Slow cache writes
- Database load increases with scale

**Suggested Fix:**
```typescript
// Single query to get counts
const { data } = await admin
  .from("verse_cache")
  .select('version, count(*)', { head: false, count: 'exact' })
  .eq("version", version)
  .group_by('version');

const totalCount = data?.[0]?.count || 0;

// Check for existing with RETURNING
const { data: existing } = await admin
  .from("verse_cache")
  .select("verse")
  .eq("book", book)
  .eq("chapter", chapter)
  .eq("version", version)
  .in("verse", verseNums);

const existingCount = existing?.length || 0;
```

**Ticket:** Create task: "Optimize LRU eviction query performance"

---

### 2. No Pagination for Large Cache Lookups
**File:** `supabase/functions/bible/cache.ts`
**Severity:** MEDIUM
**Issue:**
- Fetches all verses for a chapter in single query
- Large chapters (psalms) could return 500+ verses
- All data transferred even if only need first few

**Impact:**
- Slow queries for large chapters
- Network bandwidth waste

**Suggested Fix:**
```typescript
// Fetch with pagination/limit
export async function getCachedVersesPartial(
  book: string,
  chapter: number,
  version: string,
  limit: number = 100,
  offset: number = 0
): Promise<Record<string, string> | null> {
  const admin = getAdminClient();
  
  const { data, count } = await admin
    .from("verse_cache")
    .select("verse, text", { count: "exact" })
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("version", version)
    .order("verse", { ascending: true })
    .range(offset, offset + limit - 1);
  
  if (!data || data.length === 0) return null;
  
  const verses: Record<string, string> = {};
  for (const row of data) {
    verses[row.verse.toString()] = row.text;
  }
  
  return verses;
}
```

**Ticket:** Create task: "Add pagination support for large chapter fetches"

---

## Scale Issues

### 1. API Adapter Calls Not Batched
**File:** `supabase/functions/bible/index.ts`
**Severity:** MEDIUM
**Issue:**
- Each verse request makes separate API call to ESV/NLT
- No batching mechanism for related verses
- Could fetch "John 3:16-18" as 3 separate calls

**Impact:**
- Wasted external API quota
- Slow performance
- Higher costs

**Suggested Fix:**
```typescript
// Support batch API calls
export async function fetchVersesBatch(
  references: string[],
  version: BibleVersion
): Promise<Record<string, string>> {
  const adapter = adapters[version];
  
  // Group by chapter
  const byChapter = new Map<string, string[]>();
  for (const ref of references) {
    const parsed = parseReference(ref);
    if (parsed) {
      const key = `${parsed.book} ${parsed.chapter}`;
      if (!byChapter.has(key)) {
        byChapter.set(key, []);
      }
      byChapter.get(key)!.push(ref);
    }
  }
  
  // Fetch chapters, extract needed verses
  const results: Record<string, string> = {};
  for (const [chapterRef, verseRefs] of byChapter) {
    const chapter = await adapter.fetchChapter(chapterRef, version, 0);
    for (const verseRef of verseRefs) {
      // Extract verse from chapter result
    }
  }
  
  return results;
}
```

**Ticket:** Create task: "Implement batch Bible API requests"

---

### 2. Cache Not Indexed for Efficient Lookups
**File:** Database schema (not provided but implied)
**Severity:** HIGH
**Issue:**
- If `verse_cache` table not properly indexed
- Queries like `WHERE book = ? AND chapter = ? AND version = ?` do full table scans
- With millions of verses, queries become slow

**Impact:**
- Slow cache lookups
- Database CPU maxed
- Queries timeout

**Suggested Fix:**
```sql
-- Ensure proper indexes exist
CREATE INDEX idx_verse_cache_lookup 
ON verse_cache(version, book, chapter, verse);

CREATE INDEX idx_verse_cache_lru 
ON verse_cache(version, last_used_at DESC);

-- Analyze to optimize query planning
ANALYZE verse_cache;
```

**Ticket:** Create task: "Add database indexes for Bible cache queries"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add TTL-based cache invalidation for Bible verses | CRITICAL | Data Integrity |
| Add strict verse count validation with error handling | HIGH | Quality |
| Add client-side quota checking before Bible API calls | HIGH | Error Handling |
| Validate and standardize NLT and KJV adapter implementations | HIGH | Quality |
| Add typed Bible adapter errors for better error handling | MEDIUM | Error Handling |
| Add comprehensive reference validation before API calls | MEDIUM | Quality |
| Add session cache size limits and cleanup | MEDIUM | Reliability |
| Design multi-version support architecture | HIGH | Future-Proofing |
| Design Bible metadata and commentary system | MEDIUM | Future-Proofing |
| Design audio Bible version support | MEDIUM | Future-Proofing |
| Optimize LRU eviction query performance | MEDIUM | Performance |
| Add pagination support for large chapter fetches | MEDIUM | Performance |
| Implement batch Bible API requests | MEDIUM | Scale |
| Add database indexes for Bible cache queries | HIGH | Scale |

---

## Next Review Section
→ Continue with: `BY_DOMAIN/Data-Mutations`
