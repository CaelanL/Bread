[STATUS: review_done_needs_followup]

# BY_DOMAIN/Study-Session Code Review

## Summary
The Study Session is the core learning feature allowing users to recite Bible verses, have them transcribed, and receive scores. The implementation is well-structured with good separation between UI (`app/session.tsx`), logic (`hooks/use-study-session.ts`), and utilities (`lib/study-chunks.ts`). However, there are several areas that need attention for production readiness.

---

## Critical Issues

### 1. No Retry Logic for Transcription Failures (HIGH)
**Files:** `hooks/use-study-session.ts:126-147`, `lib/api/recording.ts:19-59`
**Issue:** When `processRecordingApi()` fails, the error bubbles up and the chunk remains incomplete with no retry mechanism. Users lose their recording attempt.

**Impact:** Poor UX when network issues or transcription service hiccups occur. Users have to re-record.

**Suggested Fix:** Add retry with exponential backoff:
```typescript
async function processRecordingWithRetry(uri: string, durationMs: number, actualText: string, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await processRecordingApi(uri, durationMs, actualText);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### 2. Soniox Polling Timeout Too Long (HIGH)
**File:** `supabase/functions/process-recording/index.ts:241-274`
**Issue:** 60-second timeout with 1-second polling intervals = potentially 60 API calls per transcription.

**Impact at Scale:**
- 1000 concurrent users × 60 polls = 60,000 Soniox API calls
- No circuit breaker if Soniox is degraded
- No exponential backoff on polling

**Suggested Fix:**
- Exponential backoff on polling (1s → 2s → 4s)
- Reduce max timeout to 30s
- Add circuit breaker pattern

### 3. Recording Reference Leak Potential (MEDIUM-HIGH)
**File:** `app/session.tsx:98-109`
**Issue:** Cleanup runs only on unmount. If user navigates away mid-recording and component doesn't unmount cleanly (common in RN navigation), recording resources leak.

```typescript
useEffect(() => {
  return () => {
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      // No error tracking - silent failures
```

**Impact:** Audio resources not freed, potential memory bloat, possible audio subsystem issues.

**Suggested Fix:** Track recording state in Zustand, clean up on navigation events via `useFocusEffect`.

---

## Code Quality Issues

### 4. Seeded Random Not Actually Used for Medium Difficulty (LOW)
**File:** `lib/study-chunks.ts:84-91`
**Issue:** `seededRandom()` function is defined but never called. The `applyDifficulty()` function uses simple modulo offset instead.

```typescript
function seededRandom(seed: number): () => number { // Never used!
  // ...
}

export function applyDifficulty(text: string, difficulty: Difficulty, seed: number = 0): DisplayWord[] {
  // ...
  const offset = seed % 2; // Just 0 or 1, not true randomness
```

**Impact:** Dead code. May have been intended for more sophisticated blank distribution.

### 5. Type Coercion on chunkSize Parameter (MEDIUM)
**File:** `app/session.tsx:46-51`
**Issue:** `chunkSize` comes as string from search params, converted with `parseInt`. No validation of NaN or negative values.

```typescript
const { id, difficulty, chunkSize: chunkSizeParam } = useLocalSearchParams<{...}>();
const chunkSize = parseInt(chunkSizeParam ?? '1', 10);
// If chunkSizeParam is "abc", chunkSize = NaN
```

**Suggested Fix:** Add validation:
```typescript
const chunkSize = Math.max(1, parseInt(chunkSizeParam ?? '1', 10) || 1);
```

### 6. `any` Type in OpenAI Response Parsing (MEDIUM)
**File:** `supabase/functions/process-recording/index.ts:384-389`
**Issue:** Response parsing uses inline type annotations with `any`:
```typescript
const messageOutput = result.output?.find(
  (o: { type: string }) => o.type === "message"
);
```
Not a critical security issue but reduces type safety.

### 7. Inconsistent Error Message Handling (LOW)
**File:** `app/session.tsx:229-233`
**Issue:** Error logged as full object in alert:
```typescript
Alert.alert('Error', `Recording failed: ${error}`);
// Shows: "Recording failed: [object Object]"
```

**Suggested Fix:** Extract message: `error instanceof Error ? error.message : String(error)`

---

## Future-Proofing Issues

### 8. Hardcoded 90% Pass Threshold (MEDIUM)
**File:** `app/session.tsx:282`
**Issue:** `const passed = session.finalScore >= 90` is hardcoded. Should be configurable per difficulty or user-settable.

**Impact:** Can't A/B test different thresholds, can't offer "easy mode" with lower threshold.

### 9. Scoring Algorithm Not Extensible (MEDIUM)
**File:** `lib/study-chunks.ts:224-255`
**Issue:** Scoring weights are hardcoded:
```typescript
return denominator > 0 ? Math.round((correct + close * 0.5) / denominator * 100) : 0;
```

**Impact:** Can't adjust "close" weight, can't add new word statuses (e.g., "synonym"), can't personalize scoring.

### 10. Single Transcription Provider (HIGH)
**File:** `supabase/functions/process-recording/index.ts:179-306`
**Issue:** Soniox is the only transcription provider. If Soniox has an outage, the entire app feature is down.

**Suggested Fix:** Abstract transcription behind interface, add fallback provider (e.g., Whisper API).

### 11. Cleaning Feature Disabled with Dead Code (LOW)
**File:** `supabase/functions/process-recording/index.ts:107-150`
**Issue:** `CLEANING_ENABLED = false` but the entire `cleanTranscription()` function (80+ lines) remains.

**Impact:** Dead code in production bundle. Either remove or properly feature-flag.

---

## Scale Issues

### 12. No Request Coalescing/Debouncing (MEDIUM)
**File:** `hooks/use-study-session.ts:126-193`
**Issue:** Each recording creates independent API call. If user rapidly re-records (cancel + record + submit), multiple requests can be in flight.

**Impact at Scale:** Unnecessary server load, potential race conditions in analytics logging.

### 13. No Caching of Verse Text (MEDIUM)
**File:** `hooks/use-study-session.ts:90-107`
**Issue:** `getVerseText()` is called on every session start even if the verse was recently loaded.

**Impact:** Redundant API calls for verses user practices frequently.

### 14. Analytics Fire-and-Forget Without Batching (LOW)
**File:** `hooks/use-study-session.ts:175-186`
**Issue:** Each session completion fires an analytics request immediately:
```typescript
logSessionAttempt({...}).catch(e => console.error(...));
```

**Impact at Scale:** Many small requests. Could batch these client-side and flush periodically.

---

## Architectural Concerns

### 15. Mixed Concerns in Session Hook (MEDIUM)
**File:** `hooks/use-study-session.ts`
**Issue:** Hook manages:
- Verse loading
- Chunk state
- Recording processing
- Progress persistence
- Analytics logging

This is too many responsibilities for a single hook.

**Suggested Fix:** Split into:
- `useVerseChunks()` - verse loading and chunk management
- `useRecordingProcessor()` - transcription handling
- `useSessionProgress()` - progress tracking

### 16. Direct Zustand Access from Hook (MEDIUM)
**File:** `hooks/use-study-session.ts:167`
**Issue:** `useAppStore.getState().updateVerseProgress(...)` - accessing store directly rather than through React binding.

This bypasses React's reactivity and could cause stale closures in edge cases.

---

## Security Considerations

### 17. Audio URI Logged (LOW)
**File:** `lib/api/recording.ts:33`
**Issue:** `throw new Error(\`Audio file is empty. URI: ${audioUri}\`)` - local file path exposed in error messages.

Not a direct security issue but reveals local filesystem structure in error tracking.

### 18. No Rate Limiting on Client (MEDIUM)
**File:** `lib/api/recording.ts`
**Issue:** Server-side quota check was removed (line 86-87 comment in process-recording). No client-side rate limiting to prevent abuse.

---

## Tickets to Create

- [ ] STUDY-001: Add retry logic for transcription failures (HIGH)
- [ ] STUDY-002: Implement exponential backoff in Soniox polling (HIGH)
- [ ] STUDY-003: Add fallback transcription provider (HIGH)
- [ ] STUDY-004: Fix recording cleanup on navigation (MEDIUM-HIGH)
- [ ] STUDY-005: Validate chunkSize parameter (MEDIUM)
- [ ] STUDY-006: Make pass threshold configurable (MEDIUM)
- [ ] STUDY-007: Remove dead code (seededRandom, cleanTranscription) (LOW)
- [ ] STUDY-008: Add client-side request rate limiting (MEDIUM)
- [ ] STUDY-009: Split use-study-session hook into smaller hooks (MEDIUM)

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `app/session.tsx` | 548 | ✅ Reviewed |
| `hooks/use-study-session.ts` | 246 | ✅ Reviewed |
| `lib/study-chunks.ts` | 294 | ✅ Reviewed |
| `lib/api/recording.ts` | 90 | ✅ Reviewed |
| `supabase/functions/process-recording/index.ts` | 409 | ✅ Reviewed |
| `lib/align.ts` | 125 | ✅ Reviewed |

---

## Next Section
Continue with `BY_DOMAIN/Library-Management/`
