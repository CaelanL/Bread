[STATUS: review_done_needs_followup]

# API-Layer Review

## Summary
The API Layer provides a clean abstraction over Supabase with focused modules for bible, analytics, and recording operations. However, there are concerns around error handling consistency, request timeout management, retry logic, and lack of request deduplication.

---

## Critical Issues

### 1. No Request Timeout Management
**File:** `lib/api/client.ts`, all API modules
**Severity:** HIGH
**Issue:**
- Supabase client has no default timeout
- Long requests can hang indefinitely
- No abort mechanism for stuck requests
- Users see frozen UI with no feedback

**Impact:**
- Frozen app during network issues
- User confusion and forced close
- Battery drain from long-running requests

**Suggested Fix:**
```typescript
// Add timeout wrapper
export async function fetchWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Request timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

// Usage
export const fetchVerse = async (reference: string, version: BibleVersion) => {
  return fetchWithTimeout(
    () => supabase.functions.invoke('bible', { body: { reference, version } }),
    30000
  );
};
```

**Ticket:** Create task: "Add timeout wrapper to all API calls"

---

### 2. No Request Deduplication
**File:** All API modules
**Severity:** MEDIUM
**Issue:**
- If user rapidly clicks "Get Verse" twice, two identical API calls go out
- Both requests processed independently
- Wastes quota and bandwidth
- Slower response due to duplicate processing

**Impact:**
- Wasted API quota
- Slower perceived performance
- Higher server load

**Suggested Fix:**
```typescript
// Request deduplication
const pendingRequests = new Map<string, Promise<any>>();

export async function fetchVerseDeduplicated(
  reference: string,
  version: BibleVersion
) {
  const key = `verse:${reference}:${version}`;
  
  // Return existing request if in flight
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }
  
  // Create new request
  const promise = fetchVerse(reference, version)
    .finally(() => pendingRequests.delete(key));
  
  pendingRequests.set(key, promise);
  return promise;
}
```

**Ticket:** Create task: "Implement request deduplication in API layer"

---

## Code Quality Issues

### 1. Inconsistent Error Handling Across Modules
**File:** `lib/api/bible.ts`, `analytics.ts`, `recording.ts`
**Severity:** MEDIUM
**Issue:**
- Some modules throw errors, some return null
- Some modules log to console, others silent
- No consistent error types

**Impact:**
- Unpredictable error handling in calling code
- Hard to implement retry logic

**Suggested Fix:**
```typescript
// Define consistent error types
export class APIError extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryable: boolean,
    message: string
  ) {
    super(message);
  }
}

// Consistent error handling
export async function fetchVerse(reference: string, version: BibleVersion) {
  try {
    const response = await fetchWithTimeout(() =>
      supabase.functions.invoke('bible', { body: { reference, version } })
    );
    
    if (!response.data) {
      throw new APIError('EMPTY_RESPONSE', 500, true, 'Empty response from Bible API');
    }
    
    return response.data;
  } catch (error) {
    if (error instanceof APIError) throw error;
    
    if (error.message.includes('timeout')) {
      throw new APIError('TIMEOUT', 408, true, 'Request timed out');
    }
    
    throw new APIError('UNKNOWN', 500, false, error.message);
  }
}
```

**Ticket:** Create task: "Standardize error types across API layer"

---

### 2. No Request Logging or Monitoring
**File:** All API modules
**Severity:** MEDIUM
**Issue:**
- No visibility into API performance
- Can't identify slow endpoints
- Can't debug user issues
- No alerting for failures

**Impact:**
- Poor observability
- Hard to optimize
- Can't diagnose production issues

**Suggested Fix:**
```typescript
// Add request logging middleware
export function logAPICall(
  endpoint: string,
  duration: number,
  status: 'success' | 'error',
  errorMessage?: string
) {
  analytics.logEvent('api_call', {
    endpoint,
    duration,
    status,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  });
}

// Use in API calls
export async function fetchVerse(reference: string, version: BibleVersion) {
  const startTime = Date.now();
  try {
    const result = await fetchWithTimeout(() =>
      supabase.functions.invoke('bible', { body: { reference, version } })
    );
    logAPICall(`bible:${reference}`, Date.now() - startTime, 'success');
    return result.data;
  } catch (error) {
    logAPICall(`bible:${reference}`, Date.now() - startTime, 'error', error.message);
    throw error;
  }
}
```

**Ticket:** Create task: "Add API call logging and monitoring"

---

## Performance Issues

### 1. No Response Caching at API Layer
**File:** All API modules
**Severity:** MEDIUM
**Issue:**
- Bible verses fetched fresh every time
- Same verse requested multiple times = multiple API calls
- No cache-control headers respected

**Impact:**
- Wasted quota
- Slow performance
- Network waste

**Suggested Fix:**
```typescript
// Cache at API layer
const apiCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export async function fetchVerseCached(reference: string, version: BibleVersion) {
  const key = `bible:${reference}:${version}`;
  const cached = apiCache.get(key);
  
  // Return cached if fresh
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // Fetch fresh
  const data = await fetchVerse(reference, version);
  apiCache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

**Ticket:** Create task: "Add response caching at API layer"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add timeout wrapper to all API calls | HIGH | Reliability |
| Implement request deduplication in API layer | MEDIUM | Performance |
| Standardize error types across API layer | MEDIUM | Quality |
| Add API call logging and monitoring | MEDIUM | Observability |
| Add response caching at API layer | MEDIUM | Performance |

---

## Next Review Section
→ Continue with: `BY_LAYER/Backend-Functions`
