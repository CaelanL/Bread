[STATUS: review_done_needs_followup]

# BY_ARCHITECTURE/Error-Handling Code Review

## Summary
Error handling is inconsistent across the codebase. The backend has well-structured error utilities (`_shared/errors.ts`), but the frontend lacks a centralized error handling strategy. There are 29+ `catch` blocks with varied patterns: some throw, some return default values, some log and swallow. User-facing error messages are generic. No error monitoring or analytics.

---

## Error Handling Audit

### Patterns Found

| Pattern | Count | Quality |
|---------|-------|---------|
| `console.error()` only | 15+ | Poor |
| `throw new Error()` | 10+ | OK |
| Return default value | 8+ | Depends |
| `Alert.alert()` to user | 5+ | OK |
| Silent failure | 3+ | Poor |

---

## Critical Issues

### 1. Silent Failures in Store (HIGH)
**File:** `lib/store/index.ts`
**Issue:** Many store methods catch errors and do nothing:

```typescript
// fetchCollections - sets error but keeps loading false
catch (e) {
  console.error('[STORE] Collection fetch error:', e);
  set({ collectionsLoading: false, error: 'Failed to load collections' });
  return false;
}

// updateVerseProgress - silent return
if (error) {
  console.error('[STORE] Failed to update progress:', error);
  return; // Progress not saved, user doesn't know!
}
```

**Impact:** User actions appear successful but data isn't persisted.

### 2. No Global Error Boundary (HIGH)
**Issue:** No React error boundary to catch component crashes.

**Impact:** Unhandled exception = white screen of death.

**Suggested Fix:**
```tsx
// app/_layout.tsx
<ErrorBoundary fallback={<ErrorScreen />}>
  <Stack />
</ErrorBoundary>
```

### 3. Generic Error Messages (HIGH)
**Files:** Multiple
**Issue:** All errors shown as generic strings:

```typescript
// lib/api/bible.ts:114
throw new Error(error.error || "Failed to fetch verse");

// lib/api/recording.ts:79
throw new Error(error.error || "Processing failed");
```

**Impact:** "Processing failed" doesn't help user or debugger.

### 4. No Retry on Network Errors (HIGH)
**Files:** All API calls
**Issue:** Network failures immediately throw without retry:

```typescript
const response = await fetch(`${baseUrl}/functions/v1/bible?${params}`, {...});
if (!response.ok) {
  throw new Error(...); // No retry!
}
```

---

## Code Quality Issues

### 5. Inconsistent Error Logging Format (MEDIUM)
**Files:** Throughout
**Issue:** Log prefixes vary:

```typescript
console.error('[STORE] Failed to...');
console.error('[ANALYTICS] Failed to...');
console.error('OpenAI request error:', error);  // No prefix
console.error('Soniox upload error:', error);   // No prefix
```

**Suggested Fix:** Standardized logger with consistent format.

### 6. Errors Not Propagated to UI (MEDIUM)
**File:** `lib/store/index.ts`
**Issue:** Store has `error` state but it's rarely shown:

```typescript
// Store sets error
set({ error: 'Failed to load collections' });

// But components often don't use it
const error = useStoreError(); // Rarely used
```

### 7. Try-Catch Covers Too Much (MEDIUM)
**File:** `app/session.tsx:198-234`
**Issue:** Large try-catch makes debugging hard:

```typescript
try {
  setTranscribing(true);
  const status = await recordingRef.current.getStatusAsync();
  await recordingRef.current.stopAndUnloadAsync();
  const uri = recordingRef.current.getURI();
  setRecordingState('idle');
  await session.processRecording(uri, durationMs);
  hideRecordingBar(() => setTranscribing(false));
} catch (error) {
  // Which step failed?
  console.error('Recording submission failed:', error);
}
```

### 8. Error State Not Cleared (LOW)
**File:** `lib/store/index.ts:309-311`
**Issue:** `clearError()` exists but rarely called:

```typescript
clearError: () => {
  set({ error: null });
},
// Only called explicitly, not automatically on success
```

---

## Backend Error Handling

### Positive: Well-Structured Error Utilities
**File:** `supabase/functions/_shared/errors.ts`
**Quality:** Good

```typescript
export function badRequest(message: string): Response
export function unauthorized(message?: string): Response
export function notFound(message?: string): Response
export function rateLimited(used, limit, resetsAt): Response
export function serverError(message?: string): Response
```

### Issue: No Error Codes (MEDIUM)
**Issue:** Errors use messages, not codes:

```typescript
return errorResponse("Rate limit exceeded", 429, {...});
// Better: return errorResponse("RATE_LIMIT_EXCEEDED", 429, {...});
```

**Impact:** Client can't programmatically handle specific errors.

---

## Error Categories Analysis

### Network Errors
- **Handled:** Rate limit (429) shows user-friendly message
- **Not Handled:** Timeouts, connection refused
- **Not Handled:** Offline mode

### API Errors
- **Handled:** 4xx/5xx basic handling
- **Not Handled:** Retry logic
- **Not Handled:** Circuit breaker

### Data Errors
- **Handled:** Missing data returns defaults
- **Not Handled:** Data validation
- **Not Handled:** Sync conflicts

### Device Errors
- **Handled:** Microphone permission
- **Not Handled:** Storage full
- **Not Handled:** Recording failure recovery

---

## Future-Proofing Issues

### 9. No Error Monitoring (HIGH)
**Issue:** Errors only go to `console.error()`. No:
- Sentry/Bugsnag integration
- Error analytics
- Crash reporting

### 10. No Error Recovery (MEDIUM)
**Issue:** Failed operations have no retry UI:

```typescript
// User adds verse, network fails
await addVerse(...); // Throws
// User sees error, verse lost, must re-add manually
```

### 11. No Offline Queue (MEDIUM)
**Issue:** When offline, operations fail immediately. No queuing for retry.

---

## Error Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     ERROR OCCURS                         │
└──────────────────────────┬──────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ BACKEND  │    │  STORE   │    │  HOOKS   │
    │ (Edge    │    │ (Zustand)│    │ (React)  │
    │ Functions)    │          │    │          │
    └─────┬────┘    └─────┬────┘    └─────┬────┘
          │               │               │
          ▼               ▼               ▼
    Return HTTP     console.error    throw/return
    Error Response   + set error      default
          │               │               │
          │               │               │
          ▼               ▼               ▼
    ┌─────────────────────────────────────────────────────┐
    │              CLIENT RECEIVES ERROR                   │
    └──────────────────────────┬──────────────────────────┘
                               │
               ┌───────────────┼───────────────┐
               │               │               │
               ▼               ▼               ▼
         Alert.alert()   Swallowed      UI shows
         (5 places)      (15+ places)   loading forever
```

---

## Recommendations

### Immediate Fixes

1. **Add Error Boundary**
```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <ErrorScreen />;
    return this.props.children;
  }
}
```

2. **Create Error Logger**
```typescript
const logger = {
  error: (tag: string, message: string, error?: Error) => {
    console.error(`[${tag}] ${message}`, error);
    // Future: send to Sentry
  }
};
```

3. **Add Retry Utility**
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

---

## Tickets to Create

- [ ] ERR-001: Add React Error Boundary (HIGH)
- [ ] ERR-002: Implement retry logic for API calls (HIGH)
- [ ] ERR-003: Show store errors in UI (HIGH)
- [ ] ERR-004: Add Sentry/error monitoring integration (HIGH)
- [ ] ERR-005: Standardize error logging format (MEDIUM)
- [ ] ERR-006: Add error codes to backend responses (MEDIUM)
- [ ] ERR-007: Add offline error queue (MEDIUM)
- [ ] ERR-008: Create centralized error handler (MEDIUM)
- [ ] ERR-009: Add user-friendly error messages (MEDIUM)
- [ ] ERR-010: Add retry UI for failed operations (LOW)

---

## Files with Error Handling

| File | catch blocks | Pattern | Quality |
|------|--------------|---------|---------|
| `lib/store/index.ts` | 7 | Mixed | Poor |
| `app/session.tsx` | 3 | Alert | OK |
| `hooks/use-recording.ts` | 3 | Throw | OK |
| `lib/storage/index.ts` | 4 | Return default | OK |
| `supabase/functions/process-recording/index.ts` | 3 | serverError() | Good |
| `app/(tabs)/home.tsx` | 3 | Swallow | Poor |
| `app/(tabs)/(library)/add/[book]/[chapter].tsx` | 2 | Alert | OK |

---

## Next Steps

This completes the initial code review pass. Consider:
1. Creating a summary/prioritization document
2. Grouping tickets by priority
3. Planning implementation sprints
