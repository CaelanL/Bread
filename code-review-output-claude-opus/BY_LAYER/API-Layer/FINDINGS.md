[STATUS: review_done_needs_followup]

# BY_LAYER/API-Layer Code Review

## Summary
The API layer provides a clean abstraction over Supabase with dedicated modules for Bible data, analytics, recordings, and VOTM. Session caching is implemented for Bible verses. However, there are concerns around error handling consistency, missing retry logic, and inefficient data fetching patterns.

---

## Critical Issues

### 1. No Retry Logic for API Failures (HIGH)
**Files:** All API modules
**Issue:** No retry mechanism for transient failures:

```typescript
// bible.ts:97-104
const response = await fetch(`${baseUrl}/functions/v1/bible?${params}`, {
  method: "GET",
  headers: { Authorization: `Bearer ${token}` },
});
// If this fails due to network, no retry
```

**Impact:** Single network hiccup = failed operation, poor UX on flaky connections.

**Suggested Fix:** Add exponential backoff retry wrapper.

### 2. N Individual Requests in fetchVerses (HIGH)
**File:** `lib/api/bible.ts:148-154`
**Issue:** `fetchVerses` makes N parallel requests instead of batching:

```typescript
export async function fetchVerses(
  references: string[],
  version: BibleVersion = "ESV"
): Promise<BibleVerse[]> {
  return Promise.all(references.map((ref) => fetchVerse(ref, version)));
}
```

**Impact:** 50 verses = 50 HTTP requests simultaneously. Server overload, rate limiting.

**Suggested Fix:** Implement batched endpoint or request coalescing.

### 3. Inefficient Analytics Queries (HIGH)
**File:** `lib/api/analytics.ts:63-108` (getCurrentStreak)
**Issue:** Fetches ALL session attempts, then processes in JS:

```typescript
const { data, error } = await supabase
  .from('session_attempts')
  .select('created_at')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });
// No LIMIT! Fetches entire history

const uniqueDates = [...new Set(
  data.map(row => getLocalDateString(new Date(row.created_at)))
)]; // Processes in JS
```

**Impact:** User with 10,000 attempts = 10,000 rows downloaded to calculate a streak.

**Suggested Fix:** Server-side aggregation with SQL or stored procedure.

### 4. Same Issue in getTotalPracticeDays (HIGH)
**File:** `lib/api/analytics.ts:113-130`
**Issue:** Also fetches ALL data:

```typescript
const { data, error } = await supabase
  .from('session_attempts')
  .select('created_at')
  .eq('user_id', user.id);
// No pagination!
```

---

## Code Quality Issues

### 5. Inconsistent Error Return Types (MEDIUM)
**Files:** All API modules
**Issue:** Some functions throw, some return null:

```typescript
// bible.ts - throws
throw new Error(error.error || "Failed to fetch verse");

// votm.ts - returns null
if (error || !data) {
  return null;
}

// analytics.ts - returns 0/null
if (error || !data) return 0;
```

### 6. Silent Failure in logSessionAttempt (MEDIUM)
**File:** `lib/api/analytics.ts:33-57`
**Issue:** Errors only logged, not propagated:

```typescript
if (error) {
  console.error('[ANALYTICS] Failed to log session attempt:', error);
  // No throw, no return value indicating failure
}
```

**Impact:** Caller can't know if analytics was logged.

### 7. Duplicate Auth Token Fetching (LOW)
**File:** `lib/api/bible.ts:89, 181`
**Issue:** Every function fetches auth token independently:

```typescript
const token = await getAuthToken();
```

Could be cached or passed as parameter.

### 8. Type Assertion Without Validation (MEDIUM)
**File:** `lib/api/bible.ts:214`
**Issue:** `result.verses` used without type checking:

```typescript
if (result.verses) {
  setChapterInSession(book, chapter, version, result.verses);
}
// No validation that verses is Record<string, string>
```

---

## Future-Proofing Issues

### 9. Hardcoded API Paths (LOW)
**Files:** All API modules
**Issue:** Endpoint paths scattered throughout:

```typescript
`${baseUrl}/functions/v1/bible?${params}`
`${baseUrl}/functions/v1/process-recording`
```

**Suggested Fix:** Centralize in constants file.

### 10. No API Versioning Strategy (MEDIUM)
**Issue:** No version prefix pattern for breaking changes:

```typescript
/functions/v1/bible  // v1 is Supabase convention, not our versioning
```

### 11. No Request/Response Interceptors (MEDIUM)
**Issue:** Can't easily add:
- Global error handling
- Request logging
- Response transformation
- Auth token injection

**Suggested Fix:** Create API client wrapper with interceptor support.

### 12. Tightly Coupled to Supabase (MEDIUM)
**Issue:** Direct Supabase SDK usage everywhere. Switching backends requires rewriting all modules.

---

## Scale Issues

### 13. No Request Deduplication (MEDIUM)
**File:** `lib/api/bible.ts`
**Issue:** If `fetchVerse("John 3:16")` is called twice simultaneously, two requests are made.

**Suggested Fix:** Implement request deduplication with in-flight request map.

### 14. Session Cache Not Bounded (LOW)
**File:** Referenced via `lib/cache/session-cache.ts`
**Issue:** Cache can grow unbounded if user browses many chapters.

### 15. getTotalTimeStudied Fetches All Rows (HIGH)
**File:** `lib/api/analytics.ts:135-147`
**Issue:** Downloads all attempts just to sum duration:

```typescript
const { data, error } = await supabase
  .from('session_attempts')
  .select('recording_duration_ms')
  .eq('user_id', user.id);
// Could be: .select('sum(recording_duration_ms)').single()
```

---

## Architectural Concerns

### 16. Mixed Responsibilities in bible.ts (MEDIUM)
**File:** `lib/api/bible.ts`
**Issue:** File handles:
- API calls
- Session caching
- Reference parsing
- Reference formatting

**Suggested Fix:** Separate into `bible-api.ts`, `bible-cache.ts`, `bible-utils.ts`.

### 17. No Offline Support (LOW)
**Issue:** All API calls fail immediately when offline. No queue for later retry.

### 18. Date Calculation in Multiple Timezones (LOW)
**File:** `lib/api/analytics.ts:13-15`
**Issue:** `getLocalDateString` uses client timezone, but server stores UTC:

```typescript
function getLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${...}`;
}
```

This works but could cause edge cases around midnight.

---

## Positive Observations

1. **Session Caching**: Good use of session cache for Bible verses
2. **Clean Interfaces**: `BibleVerse`, `ChapterResponse`, `SessionAttemptData` are well-typed
3. **Proper Query Building**: Uses URLSearchParams for GET requests
4. **Rate Limit Handling**: Catches 429 errors and provides user-friendly message
5. **Separation of Concerns**: Different API modules for different features

---

## Tickets to Create

- [ ] API-001: Add retry logic with exponential backoff (HIGH)
- [ ] API-002: Implement batch verse fetching endpoint (HIGH)
- [ ] API-003: Move streak/practice days calculation to server (HIGH)
- [ ] API-004: Use SQL aggregation for getTotalTimeStudied (HIGH)
- [ ] API-005: Standardize error handling (throw vs return) (MEDIUM)
- [ ] API-006: Add request deduplication (MEDIUM)
- [ ] API-007: Create centralized API client with interceptors (MEDIUM)
- [ ] API-008: Add response type validation (MEDIUM)
- [ ] API-009: Centralize endpoint paths (LOW)
- [ ] API-010: Add offline queue for analytics (LOW)

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `lib/api/client.ts` | 67 | ✅ Reviewed |
| `lib/api/index.ts` | 12 | ✅ Reviewed |
| `lib/api/bible.ts` | 279 | ✅ Reviewed |
| `lib/api/recording.ts` | 90 | ✅ Reviewed |
| `lib/api/analytics.ts` | 168 | ✅ Reviewed |
| `lib/api/votm.ts` | 90 | ✅ Reviewed |

---

## Next Section
Continue with `BY_ARCHITECTURE/Data-Flow/`
