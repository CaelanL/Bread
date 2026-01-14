[STATUS: review_done_needs_followup]

# Backend-Functions Layer Review

## Summary
The Backend-Functions layer implements edge functions for Bible data fetching, recording processing, and utility operations. The architecture is sound with adapter pattern and normalization. However, there are critical concerns around resource cleanup, error handling, concurrency limits, and the lack of request validation.

---

## Critical Issues

### 1. No Request Validation Before Processing
**File:** `supabase/functions/bible/index.ts`, `process-recording/index.ts`
**Severity:** HIGH
**Issue:**
- Functions don't validate input before expensive processing
- Could waste resources on invalid requests
- No rate limiting per user
- Malicious or accidental abuse possible

**Impact:**
- Resource exhaustion
- Quota waste
- Potential DoS

**Suggested Fix:**
```typescript
// Add validation middleware
export async function validateAndProcessRecording(req: Request) {
  const body = await req.json();
  
  // Validate required fields
  if (!body.uri || !body.durationMs) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { status: 400 }
    );
  }
  
  // Validate value ranges
  if (body.durationMs < 1000 || body.durationMs > 600000) {
    return new Response(
      JSON.stringify({ error: 'Duration must be 1-600 seconds' }),
      { status: 400 }
    );
  }
  
  // Check rate limit
  const userId = getAuthUserId(req);
  const rateLimitOk = await checkRateLimit(userId, 'recording', 10, 3600);
  if (!rateLimitOk) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      { status: 429 }
    );
  }
  
  // Process after validation
  return processRecording(body);
}
```

**Ticket:** Create task: "Add request validation and rate limiting to backend functions"

---

### 2. No Resource Cleanup on Function Timeout
**File:** `supabase/functions/process-recording/index.ts`
**Severity:** HIGH
**Issue:**
- If function times out, temporary files not cleaned up
- Audio files left on disk
- Memory not released
- Accumulates over time

**Impact:**
- Disk space usage grows indefinitely
- Memory leaks
- Function performance degrades

**Suggested Fix:**
```typescript
// Add cleanup wrapper
async function withCleanup<T>(
  fn: () => Promise<T>,
  cleanup: () => Promise<void>
): Promise<T> {
  try {
    return await fn();
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  }
}

// Usage
export async function processRecording(req: Request) {
  const tempFiles: string[] = [];
  
  return withCleanup(
    async () => {
      const tempFile = await downloadAudio(req, tempFiles);
      const transcription = await transcribeAudio(tempFile);
      return { transcription };
    },
    async () => {
      for (const file of tempFiles) {
        try {
          await Deno.remove(file);
        } catch (e) {
          console.warn(`Failed to remove temp file ${file}:`, e);
        }
      }
    }
  );
}
```

**Ticket:** Create task: "Add resource cleanup to backend functions"

---

### 3. Concurrency Not Limited
**File:** `supabase/functions/process-recording/index.ts`
**Severity:** MEDIUM
**Issue:**
- Multiple recording processes can run simultaneously
- No limit on concurrent transcription requests
- Could overwhelm transcription service
- Could exceed quota limits

**Impact:**
- Service degradation
- Quota exceeded
- Failed requests

**Suggested Fix:**
```typescript
// Add concurrency limiter
import { semaphore } from '../_shared/concurrency.ts';

const MAX_CONCURRENT_RECORDING = 5;
const recordingSemaphore = semaphore(MAX_CONCURRENT_RECORDING);

export async function processRecording(req: Request) {
  const release = await recordingSemaphore.acquire();
  
  try {
    // Process recording with limited concurrency
    return await doProcessRecording(req);
  } finally {
    release();
  }
}
```

**Ticket:** Create task: "Add concurrency limiting to recording processor"

---

## Code Quality Issues

### 1. No Request ID Tracking
**File:** All function files
**Severity:** MEDIUM
**Issue:**
- No trace ID for debugging
- Can't match requests to logs
- Hard to debug production issues

**Impact:**
- Poor observability
- Hard to debug user issues

**Suggested Fix:**
```typescript
// Add request tracking
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function handleRequest(req: Request) {
  const requestId = req.headers.get('x-request-id') || generateRequestId();
  
  console.log(`[${requestId}] ${req.method} ${new URL(req.url).pathname}`);
  
  try {
    const response = await processRequest(req);
    console.log(`[${requestId}] Response: ${response.status}`);
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error, { 'x-request-id': requestId });
  }
}
```

**Ticket:** Create task: "Add request ID tracking to backend functions"

---

### 2. Silent Failures in Adapter Processing
**File:** `supabase/functions/bible/adapters/*.ts`
**Severity:** MEDIUM
**Issue:**
- Adapter errors caught and logged but not propagated
- Could return empty/incomplete data
- User doesn't know fetch failed

**Impact:**
- Silent data loss
- User confusion

**Suggested Fix:**
```typescript
// More explicit error handling
try {
  const verses = await adapter.fetchChapter(ref, version, expectedCount);
  if (!verses || verses.length === 0) {
    throw new Error(`No verses returned by ${adapter.id}`);
  }
  return verses;
} catch (error) {
  console.error(`[${adapter.id}] Failed to fetch ${ref}:`, error);
  throw new AdapterError(adapter.id, error.message);
}
```

**Ticket:** Create task: "Add explicit error propagation in Bible adapters"

---

## Performance Issues

### 1. No Connection Pooling for Database
**File:** All functions accessing database
**Severity:** MEDIUM
**Issue:**
- Each function invocation creates new connection
- No connection pooling
- Slow on high concurrency

**Impact:**
- High latency
- Connection exhaustion at scale
- Slow performance

**Suggested Fix:**
```typescript
// Implement connection pool
import { Pool } from 'https://deno.land/x/postgres/mod.ts';

const connectionPool = new Pool({
  hostname: Deno.env.get('DB_HOST'),
  port: 5432,
  database: Deno.env.get('DB_NAME'),
  user: Deno.env.get('DB_USER'),
  password: Deno.env.get('DB_PASSWORD'),
  connectionTimeoutMillis: 10000,
  max: 20, // max connections
});

// Use from pool
const client = await connectionPool.connect();
try {
  // Execute queries
} finally {
  client.release();
}
```

**Ticket:** Create task: "Implement database connection pooling"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add request validation and rate limiting to backend functions | HIGH | Security/Reliability |
| Add resource cleanup to backend functions | HIGH | Reliability |
| Add concurrency limiting to recording processor | MEDIUM | Reliability |
| Add request ID tracking to backend functions | MEDIUM | Observability |
| Add explicit error propagation in Bible adapters | MEDIUM | Quality |
| Implement database connection pooling | MEDIUM | Performance |

---

## Next Review Section
→ Continue with: `BY_LAYER/Data-Sync`
