[STATUS: review_done_needs_followup]

# Type-System Layer Review

## Summary
The Type-System layer demonstrates good TypeScript usage with proper interfaces for core entities. However, there are significant gaps around error types, API responses, union types for state, and missing strict mode configurations. Type safety could be improved across the board.

---

## Critical Issues

### 1. No Typed Error Responses from API
**File:** All API modules, backend functions
**Severity:** HIGH
**Issue:**
- Error responses not properly typed
- API callers can't distinguish error types
- No compile-time safety for error handling
- Runtime errors possible

**Impact:**
- Can't implement smart retry logic
- Poor error handling in UI
- Hard to debug

**Suggested Fix:**
```typescript
// Define typed error responses
export type APIResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: APIError };

export interface APIError {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  details?: Record<string, any>;
}

// Type-safe error handling
export async function fetchVerse(ref: string): Promise<APIResponse<VerseData>> {
  try {
    const response = await supabase.functions.invoke('bible', { body: { ref } });
    
    if (!response.data) {
      return {
        success: false,
        error: {
          code: 'EMPTY_RESPONSE',
          message: 'Bible API returned no data',
          status: 500,
          retryable: true,
        },
      };
    }
    
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error.message,
        status: 0,
        retryable: true,
      },
    };
  }
}

// Type-safe usage in component
const result = await fetchVerse('John 3:16');
if (result.success) {
  displayVerse(result.data);
} else {
  if (result.error.retryable) {
    showRetryButton(result.error);
  } else {
    showError(result.error.message);
  }
}
```

**Ticket:** Create task: "Add typed API response types for all endpoints"

---

### 2. Weak Type Coverage in Store State
**File:** `lib/store/index.ts`
**Severity:** MEDIUM
**Issue:**
```typescript
// State could be typed better
export interface AppState {
  collections: any[]; // Should be Collection[]
  verses: any[]; // Should be Verse[]
  mastered: any[]; // Should be MasteredVerse[]
  error: string | null; // Could be more specific
}
```
- Uses `any` types in critical state
- No discriminated unions for async states
- No type safety for mutations

**Impact:**
- Runtime errors possible
- No compile-time safety
- Hard to refactor

**Suggested Fix:**
```typescript
// Define proper types
export interface Collection {
  id: string;
  clientId: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Verse {
  id: string;
  userId: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: BibleVersion;
  text?: string;
  progress?: VerseProgress;
  deletedAt: Date | null;
}

// Discriminated union for async states
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// Use in store
export interface AppState {
  collections: AsyncState<Collection[]>;
  verses: AsyncState<Verse[]>;
  mastered: AsyncState<MasteredVerse[]>;
}
```

**Ticket:** Create task: "Replace any types with proper typed interfaces in store"

---

### 3. No Type Guards or Validators
**File:** All API response handling
**Severity:** MEDIUM
**Issue:**
- No runtime type validation
- Assumes API responses match types
- No way to verify data at runtime

**Impact:**
- Silent failures if API returns unexpected data
- Type system provides false sense of safety
- Runtime errors possible

**Suggested Fix:**
```typescript
// Add type guards
export function isVerseData(data: unknown): data is VerseData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'verses' in data &&
    Array.isArray(data.verses) &&
    data.verses.every(v => typeof v.verse === 'number' && typeof v.text === 'string')
  );
}

// Or use schema validation
import { z } from 'https://deno.land/x/zod/mod.ts';

const VerseDataSchema = z.object({
  verses: z.array(z.object({
    verse: z.number(),
    text: z.string(),
  })),
});

export function parseVerseData(data: unknown): VerseData {
  return VerseDataSchema.parse(data);
}

// Usage
const result = await fetchVerse('John 3:16');
if (!isVerseData(result)) {
  throw new Error('Invalid verse data');
}
```

**Ticket:** Create task: "Add type guards and runtime validation for API responses"

---

## Code Quality Issues

### 1. Missing Strict TypeScript Configuration
**File:** `tsconfig.json`
**Severity:** MEDIUM
**Issue:**
```json
{
  "compilerOptions": {
    "strict": false, // ← Should be true!
    "noImplicitAny": false, // ← Should be true!
    "noUnusedLocals": false, // ← Should be true!
    "noUnusedParameters": false, // ← Should be true!
    "noImplicitReturns": false, // ← Should be true!
  }
}
```
- Not using strict mode
- Allows implicit any types
- Missing return type errors
- Dead code not detected

**Impact:**
- Type safety not enforced
- False sense of confidence
- Hard to catch errors

**Suggested Fix:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Ticket:** Create task: "Enable strict TypeScript configuration"

---

### 2. No Return Types on Functions
**File:** Throughout codebase
**Severity:** MEDIUM
**Issue:**
```typescript
// Missing return types
export const fetchCollections = async () => { // Should return Promise<Collection[]>
  // ...
};

export const calculateScore = (alignment) => { // Should return number
  // ...
};
```
- No explicit return types
- Inference can be wrong
- Makes refactoring risky

**Impact:**
- Can't catch type errors easily
- Refactoring risky
- Documentation missing

**Suggested Fix:**
```typescript
// Add return types
export const fetchCollections = async (): Promise<Collection[]> => {
  // ...
};

export const calculateScore = (alignment: AlignmentWord[]): number => {
  // ...
};

// Generic helper functions
export const memoize = <T, R>(fn: (arg: T) => R): (arg: T) => R => {
  const cache = new Map<T, R>();
  return (arg: T): R => {
    if (cache.has(arg)) return cache.get(arg)!;
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
};
```

**Ticket:** Create task: "Add explicit return types to all functions"

---

### 3. No Discriminated Unions for State Machines
**File:** Study session, auth flow
**Severity:** MEDIUM
**Issue:**
```typescript
// Weak state representation
interface SessionState {
  isRecording: boolean;
  isProcessing: boolean;
  isDone: boolean;
  error?: string;
  result?: SessionResult;
}

// Which combinations are valid?
// Can isRecording and isDone both be true?
```
- State combinations not validated at type level
- Possible invalid states
- Runtime errors possible

**Impact:**
- State machine can enter invalid states
- Bugs from impossible combinations
- Hard to reason about logic

**Suggested Fix:**
```typescript
// Discriminated union for state machine
export type SessionState =
  | { type: 'idle' }
  | { type: 'recording'; startedAt: Date }
  | { type: 'processing'; recordingUri: string; durationMs: number }
  | { type: 'complete'; result: SessionResult }
  | { type: 'error'; error: string; canRetry: boolean };

// Now state transitions are type-safe
const handleStateTransition = (state: SessionState, action: SessionAction): SessionState => {
  switch (state.type) {
    case 'idle':
      if (action.type === 'start_recording') {
        return { type: 'recording', startedAt: new Date() };
      }
      // TypeScript enforces only valid actions
      
    case 'recording':
      if (action.type === 'stop_recording') {
        return { type: 'processing', recordingUri: action.uri, durationMs: action.duration };
      }
      // Can't transition to 'complete' from 'recording'
  }
};
```

**Ticket:** Create task: "Use discriminated unions for state machines"

---

## Performance Issues

### 1. No Generic Type Constraints
**File:** Generic components and hooks
**Severity:** LOW
**Issue:**
```typescript
// Too broad generic
export function useQuery<T>(key: string): T {
  // Can't optimize, T could be anything
}
```
- No constraints on generic types
- Can't add optimization hints
- Unnecessary re-renders possible

**Impact:**
- Marginal performance impact
- Lost optimization opportunities

**Suggested Fix:**
```typescript
// Add constraints
export function useQuery<T extends Record<string, any>>(key: string): T {
  // Now we know T is an object
}

export function useMemo<T>(fn: () => T, deps: React.DependencyList): T {
  return React.useMemo(fn, deps);
}
```

**Ticket:** Create task: "Add generic type constraints for better optimization"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add typed API response types for all endpoints | HIGH | Type Safety |
| Replace any types with proper typed interfaces in store | MEDIUM | Type Safety |
| Add type guards and runtime validation for API responses | MEDIUM | Quality |
| Enable strict TypeScript configuration | MEDIUM | Type Safety |
| Add explicit return types to all functions | MEDIUM | Type Safety |
| Use discriminated unions for state machines | MEDIUM | Type Safety |
| Add generic type constraints for better optimization | LOW | Performance |

---

## Type-System Summary

The codebase has decent TypeScript usage but lacks:
- **Strict mode:** Not enforced, allowing implicit any
- **Error types:** No typed error responses from API
- **State machines:** No discriminated unions for complex states
- **Type guards:** No runtime validation
- **Documentation:** Missing return type annotations

**Recommendation:** Enable strict mode as first step, then gradually add typed responses and state machines.
