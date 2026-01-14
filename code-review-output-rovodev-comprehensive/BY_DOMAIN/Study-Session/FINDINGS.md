[STATUS: review_done_needs_followup]

# Study-Session Domain Review

## Summary
The Study-Session domain implements the core learning loop with recording, transcription, alignment, and scoring. The architecture is well-thought-out with async transcription and local alignment calculation. However, there are critical concerns around error recovery, recording reliability, race conditions in progress updates, and the complexity of the session state hook.

---

## Critical Issues

### 1. No Recovery Mechanism for Failed Recording Submissions
**File:** `hooks/use-study-session.ts` (lines ~125-191)
**Severity:** CRITICAL
**Issue:**
- `processRecording()` uploads audio to server and updates progress in one flow
- If progress update fails after successful transcription, user loses the attempt
- No retry mechanism for failed submissions
- No local caching of successful transcriptions that failed to update progress
- User receives error but data may be silently lost

**Impact:**
- User frustration (lost study time)
- Inconsistent progress tracking
- Users may abandon app after multiple failures
- Data loss in analytics

**Suggested Fix:**
```typescript
interface PendingAttempt {
  verseId: string;
  difficulty: Difficulty;
  score: number;
  alignment: AlignmentWord[];
  timestamp: number;
}

// Queue failed submissions
const pendingQueue = useRef<PendingAttempt[]>([]);

const processRecording = async (uri: string, durationMs: number) => {
  try {
    const { cleanedTranscription } = await processRecordingApi(uri, durationMs, actualText);
    const alignment = alignTranscription(actualText, cleanedTranscription);
    const score = calculateChunkScore(alignment);
    
    // Try to update progress
    try {
      await useAppStore.getState().updateVerseProgress(verseId, difficulty, score);
    } catch (updateError) {
      // Queue for later retry
      pendingQueue.current.push({ verseId, difficulty, score, alignment, timestamp: Date.now() });
      console.warn('[STUDY] Queued failed update:', updateError);
      throw updateError;
    }
  } catch (error) {
    // Handle gracefully
  }
};

// Periodically retry queued submissions
useEffect(() => {
  const retryInterval = setInterval(async () => {
    const queue = pendingQueue.current;
    if (queue.length === 0) return;
    
    const attempt = queue[0];
    try {
      await useAppStore.getState().updateVerseProgress(attempt.verseId, attempt.difficulty, attempt.score);
      queue.shift();
    } catch (error) {
      console.warn('[STUDY] Retry failed, will try again later');
    }
  }, 30000);
  
  return () => clearInterval(retryInterval);
}, []);
```

**Ticket:** Create task: "Add retry queue for failed progress updates"

---

### 2. Race Condition in Concurrent Recording Submissions
**File:** `hooks/use-study-session.ts`, `app/session.tsx`
**Severity:** CRITICAL
**Issue:**
- User can submit multiple recordings for the same chunk by rapid tapping
- Each submission tries to update progress independently
- Later submissions may overwrite earlier ones with lower scores
- No debouncing or submission lock

**Impact:**
- Incorrect progress scores
- User confusion about what score was recorded
- Duplicate session attempts in analytics

**Suggested Fix:**
```typescript
const submittingRef = useRef(false);

const processRecording = useCallback(async (uri: string, durationMs: number) => {
  // Prevent concurrent submissions
  if (submittingRef.current) {
    console.warn('[STUDY] Submission already in progress, ignoring duplicate');
    return { score: 0, alignment: [], allDone: false };
  }
  
  submittingRef.current = true;
  try {
    // ... actual processing
  } finally {
    submittingRef.current = false;
  }
}, []);
```

**Ticket:** Create task: "Add submission debouncing to prevent race conditions"

---

### 3. No Graceful Handling of Recording Failures
**File:** `app/session.tsx` (lines ~130-160 estimated)
**Severity:** HIGH
**Issue:**
- If microphone permission denied, only shows Alert, doesn't guide user
- If recording fails mid-session (storage full, permissions revoked), session crashes
- No recovery path shown to user
- Audio cleanup may not happen on error

**Impact:**
- User left in broken state
- Can't recover without restarting app
- Microphone issues difficult to diagnose

**Suggested Fix:**
```typescript
const handleMicPress = useCallback(async () => {
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Microphone Permission Required',
        'BibleMem needs access to your microphone to record your memorization attempts. Please enable it in Settings.',
        [
          { text: 'Cancel', onPress: () => {} },
          { 
            text: 'Open Settings', 
            onPress: () => Linking.openSettings()
          }
        ]
      );
      return;
    }
    
    // Try to record
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
    recordingRef.current = recording;
  } catch (error) {
    console.error('[SESSION] Recording error:', error);
    Alert.alert(
      'Recording Failed',
      'Could not start recording. Try again or contact support.',
      [{ text: 'OK', onPress: () => {} }]
    );
    // Ensure cleanup
    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
  }
}, []);
```

**Ticket:** Create task: "Add comprehensive error handling for recording failures"

---

### 4. Session Progress Can Be Lost on Navigation
**File:** `hooks/use-study-session.ts` (line 105-106), `app/session.tsx`
**Severity:** HIGH
**Issue:**
- If user navigates away (back button, tab switch), session state is lost
- No automatic save of progress
- User has to restart from beginning
- Recording refs may not be cleaned up properly

**Impact:**
- User frustration with lost work
- Accidental navigation loses entire session
- Memory leaks if refs not cleaned up

**Suggested Fix:**
```typescript
// Save session to AsyncStorage periodically
useEffect(() => {
  const saveInterval = setInterval(async () => {
    if (chunkResults.size === 0) return;
    
    const sessionState = {
      verseId,
      difficulty,
      chunkSize,
      completedChunks: Array.from(completedChunks),
      chunkResults: Array.from(chunkResults.entries()),
      timestamp: Date.now(),
    };
    
    try {
      await AsyncStorage.setItem(
        `session_${verseId}_${difficulty}`,
        JSON.stringify(sessionState)
      );
    } catch (error) {
      console.warn('[STUDY] Failed to save session:', error);
    }
  }, 5000);
  
  return () => clearInterval(saveInterval);
}, []);

// Restore session on mount
useEffect(() => {
  async function restoreSession() {
    try {
      const saved = await AsyncStorage.getItem(`session_${verseId}_${difficulty}`);
      if (saved) {
        const state = JSON.parse(saved);
        // Check if recent (< 1 hour)
        if (Date.now() - state.timestamp < 3600000) {
          setCompletedChunks(new Set(state.completedChunks));
          // ... restore other state
        }
      }
    } catch (error) {
      console.warn('[STUDY] Failed to restore session:', error);
    }
  }
  
  restoreSession();
}, []);
```

**Ticket:** Create task: "Add session persistence and restoration"

---

## Code Quality Issues

### 1. Extremely Complex Hook - `use-study-session.ts`
**File:** `hooks/use-study-session.ts` (245 lines)
**Severity:** HIGH
**Issue:**
- Single hook manages: verse loading, chunk parsing, recording processing, progress updates, analytics logging, state management
- Multiple state variables (verse, chunks, completedChunks, chunkResults, showResults, totalRecordingDurationMs)
- Complex interdependencies between state updates
- Difficult to test individually
- Hard to debug when things go wrong

**Impact:**
- Bug fixes risk breaking other functionality
- Onboarding new developers difficult
- Performance harder to optimize
- Testing requires mocking multiple functions

**Suggested Fix:**
Split into separate hooks:
```typescript
// Separate concerns
export function useVerseLoader(verseId: string) { /* ... */ }
export function useChunkProcessing(verse: SavedVerse, difficulty: Difficulty) { /* ... */ }
export function useRecordingProcessor(chunks: Chunk[], currentIndex: number) { /* ... */ }
export function useSessionProgress(chunks: Chunk[], verseId: string) { /* ... */ }

// Compose them
export function useStudySession(options) {
  const verse = useVerseLoader(options.verseId);
  const chunks = useChunkProcessing(verse, options.difficulty);
  const recordingProcessor = useRecordingProcessor(chunks, currentIndex);
  const progress = useSessionProgress(chunks, verse?.id);
  
  return { verse, chunks, ...recordingProcessor, ...progress };
}
```

**Ticket:** Create task: "Refactor use-study-session into smaller focused hooks"

---

### 2. Insufficient Error Handling in Recording Processing
**File:** `supabase/functions/process-recording/index.ts` (lines ~178-300 estimated)
**Severity:** MEDIUM
**Issue:**
- Transcription timeout is hardcoded to 60 seconds with no user feedback
- If transcription fails, returns generic "Processing failed"
- No distinction between network error vs transcription service down vs auth error
- Client can't distinguish recoverable from non-recoverable errors

**Impact:**
- User doesn't know if they should retry or wait
- Support burden for timeouts
- Poor offline handling

**Suggested Fix:**
```typescript
enum TranscriptionErrorType {
  TIMEOUT = 'timeout',
  SERVICE_DOWN = 'service_down',
  INVALID_AUDIO = 'invalid_audio',
  NETWORK_ERROR = 'network_error',
  AUTH_ERROR = 'auth_error',
  UNKNOWN = 'unknown',
}

try {
  // ... transcription logic
} catch (error) {
  let errorType = TranscriptionErrorType.UNKNOWN;
  let retryable = false;
  
  if (error.message.includes('timeout')) {
    errorType = TranscriptionErrorType.TIMEOUT;
    retryable = true;
  } else if (error.message.includes('ECONNREFUSED')) {
    errorType = TranscriptionErrorType.SERVICE_DOWN;
    retryable = true;
  } else if (error.status === 401) {
    errorType = TranscriptionErrorType.AUTH_ERROR;
    retryable = false;
  }
  
  return jsonResponse({
    error: errorType,
    retryable,
    message: getUserFriendlyMessage(errorType),
  }, { status: 500 });
}
```

**Ticket:** Create task: "Add error classification to transcription service"

---

### 3. No Validation of Alignment Score Calculation
**File:** `lib/study-chunks.ts` (lines ~200-293 estimated)
**Severity:** MEDIUM
**Issue:**
- `calculateChunkScore()` and `calculateFinalScore()` implementations not visible but critical
- No documented scoring algorithm
- Users see scores but don't understand how they're calculated
- Score algorithm can't be audited or explained

**Impact:**
- User frustration with perceived unfair scores
- Can't debug scoring issues
- Algorithm changes require app update

**Suggested Fix:**
Document and test scoring:
```typescript
/**
 * Calculate accuracy score for a chunk.
 * 
 * Scoring rules:
 * - Correct words: +1 point
 * - Close match (typo): +0.5 points
 * - Missing words: 0 points
 * - Extra words: -0.25 points (penalize fluency errors)
 * 
 * Final score: (points / expected_words) * 100
 * 
 * @param alignment - Array of AlignmentWord results
 * @returns Accuracy percentage (0-100)
 */
export function calculateChunkScore(alignment: AlignmentWord[]): number {
  let points = 0;
  const expectedWords = alignment.length;
  
  for (const word of alignment) {
    switch (word.status) {
      case 'correct': points += 1; break;
      case 'close': points += 0.5; break;
      case 'missing': points += 0; break;
      case 'added': points -= 0.25; break;
    }
  }
  
  return Math.max(0, Math.round((points / expectedWords) * 100));
}

// Test it
describe('calculateChunkScore', () => {
  it('should give 100 for perfect match', () => {
    const alignment: AlignmentWord[] = [
      { word: 'hello', status: 'correct' },
      { word: 'world', status: 'correct' },
    ];
    expect(calculateChunkScore(alignment)).toBe(100);
  });
  
  it('should handle typos', () => {
    const alignment: AlignmentWord[] = [
      { word: 'helo', status: 'close', expected: 'hello' },
      { word: 'world', status: 'correct' },
    ];
    expect(calculateChunkScore(alignment)).toBe(75); // (1.5 / 2) * 100
  });
});
```

**Ticket:** Create task: "Document and test scoring algorithm with unit tests"

---

### 4. Audio Cleanup Not Guaranteed
**File:** `app/session.tsx` (lines ~97-108)
**Severity:** MEDIUM
**Issue:**
```typescript
// Cleanup on unmount
useEffect(() => {
  return () => {
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {}); // ← Ignores errors
      recordingRef.current = null;
    }
    if (meteringRef.current) {
      clearInterval(meteringRef.current);
      meteringRef.current = null;
    }
  };
}, []);
```
- Catches and ignores cleanup errors
- Could leave files on disk
- Could leave audio context open

**Impact:**
- Memory leaks over time
- Disk space usage grows
- Audio may play through wrong output on next use

**Suggested Fix:**
```typescript
useEffect(() => {
  return () => {
    if (recordingRef.current) {
      try {
        recordingRef.current.stopAndUnloadAsync().then(() => {
          recordingRef.current = null;
        }).catch((error) => {
          console.error('[SESSION] Recording cleanup error:', error);
          recordingRef.current = null; // Force cleanup anyway
        });
      } catch (error) {
        console.error('[SESSION] Recording cleanup exception:', error);
      }
    }
    
    if (meteringRef.current) {
      clearInterval(meteringRef.current);
      meteringRef.current = null;
    }
  };
}, []);
```

**Ticket:** Create task: "Improve audio resource cleanup with error logging"

---

## Future-Proofing Issues

### 1. Difficulty Levels Hardcoded
**File:** `lib/study-chunks.ts` (lines ~6, 102-120)
**Severity:** MEDIUM
**Issue:**
```typescript
export type Difficulty = 'easy' | 'medium' | 'hard';
```
- Only supports 3 difficulty levels
- Adding new levels requires code changes everywhere
- Can't support custom difficulty curves
- Can't support adaptive difficulty

**Impact:**
- Limited feature set vs competitors
- Can't implement spaced repetition based on performance
- Difficulty adjustment requires app update

**Suggested Fix:**
```typescript
// Support extensible difficulty levels
interface DifficultyDefinition {
  id: string;
  name: string;
  maskingPercentage: number; // 0 = show all, 100 = hide all
  description: string;
}

const DIFFICULTIES: Record<string, DifficultyDefinition> = {
  'easy': { id: 'easy', name: 'Easy', maskingPercentage: 0, description: 'All words visible' },
  'medium': { id: 'medium', name: 'Medium', maskingPercentage: 50, description: 'Half words hidden' },
  'hard': { id: 'hard', name: 'Hard', maskingPercentage: 100, description: 'All words hidden' },
};

export function applyDifficulty(text: string, difficultyId: string): DisplayWord[] {
  const difficulty = DIFFICULTIES[difficultyId];
  if (!difficulty) throw new Error(`Unknown difficulty: ${difficultyId}`);
  
  // Use masking percentage instead of hardcoded logic
  const maskCount = Math.ceil((text.split(' ').length * difficulty.maskingPercentage) / 100);
  // ...
}
```

**Ticket:** Create task: "Refactor difficulty system to be extensible"

---

### 2. No Support for Different Scoring Algorithms
**File:** `lib/study-chunks.ts`
**Severity:** MEDIUM
**Issue:**
- Scoring algorithm is hardcoded
- Can't support different algorithms for research/A/B testing
- Can't adjust algorithm based on user feedback
- Moving forward will require breaking changes

**Impact:**
- Can't experiment with scoring improvements
- Can't support multiple languages with different scoring needs
- Can't adapt to user preferences

**Suggested Fix:**
```typescript
interface ScoringAlgorithm {
  id: string;
  name: string;
  calculate: (alignment: AlignmentWord[]) => number;
}

export const SCORING_ALGORITHMS: Record<string, ScoringAlgorithm> = {
  'default': {
    id: 'default',
    name: 'Standard Accuracy',
    calculate: (alignment) => {
      // Current implementation
    },
  },
  'lenient': {
    id: 'lenient',
    name: 'Lenient (ignores extras)',
    calculate: (alignment) => {
      // Alternative implementation
    },
  },
};

export function calculateScore(alignment: AlignmentWord[], algorithmId: string): number {
  const algo = SCORING_ALGORITHMS[algorithmId];
  if (!algo) throw new Error(`Unknown algorithm: ${algorithmId}`);
  return algo.calculate(alignment);
}
```

**Ticket:** Create task: "Design pluggable scoring algorithm system"

---

### 3. Chunk Parsing Not Flexible Enough
**File:** `lib/study-chunks.ts`
**Severity:** MEDIUM
**Issue:**
- `parseVerseIntoChunks()` hardcoded for Bible verses
- Chunk size parameter exists but algorithm is rigid
- Can't support other languages or text formats
- Can't support poetry-aware chunking

**Impact:**
- Limited to English Bible verses
- Can't support other religious texts
- Can't support user-customized chunk definitions

**Suggested Fix:**
```typescript
interface ChunkingStrategy {
  id: string;
  name: string;
  parseIntoChunks: (text: string, options: ChunkingOptions) => Chunk[];
}

interface ChunkingOptions {
  chunkSize: number;
  seed?: number;
  language?: string;
}

export const CHUNKING_STRATEGIES: Record<string, ChunkingStrategy> = {
  'sentence': {
    id: 'sentence',
    name: 'Sentence-based',
    parseIntoChunks: (text, opts) => {
      const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
      return sentences.map((s, i) => ({
        id: `chunk-${i}`,
        verseNum: i,
        text: s,
        displayWords: [],
      }));
    },
  },
  'word': {
    id: 'word',
    name: 'Word-based',
    parseIntoChunks: (text, opts) => {
      const words = text.split(/\s+/);
      const chunks = [];
      for (let i = 0; i < words.length; i += opts.chunkSize) {
        chunks.push({
          id: `chunk-${Math.floor(i / opts.chunkSize)}`,
          verseNum: Math.floor(i / opts.chunkSize),
          text: words.slice(i, i + opts.chunkSize).join(' '),
          displayWords: [],
        });
      }
      return chunks;
    },
  },
};
```

**Ticket:** Create task: "Design pluggable text chunking system"

---

## Architectural Concerns

### 1. Session State Too Coupled to Component
**File:** `app/session.tsx`, `hooks/use-study-session.ts`
**Severity:** MEDIUM
**Issue:**
- Session state hook returns UI-specific data (animation values, refs)
- Component logic mixed with state management
- Hard to reuse session logic in different UI contexts
- Testing requires mocking UI framework

**Impact:**
- Can't build alternative UIs (web, desktop) easily
- Harder to test business logic
- Changing animation breaks session logic

**Suggested Fix:**
Separate concerns:
```typescript
// Pure business logic (can be tested without React)
export class StudySession {
  private verse: SavedVerse;
  private chunks: Chunk[];
  private completedChunks: Set<number>;
  private chunkResults: Map<number, ChunkResult>;
  
  async processRecording(uri: string, durationMs: number): Promise<ProcessResult> {
    // Pure business logic
  }
  
  goToNextChunk(): Chunk | null {
    // Pure business logic
  }
}

// React wrapper for UI
export function useStudySession(options): UseStudySessionReturn {
  const sessionRef = useRef(new StudySession(options));
  const [state, setState] = useState(sessionRef.current.getState());
  
  // React integration
}
```

**Ticket:** Create task: "Extract session business logic from React hook"

---

### 2. No Proper Error Boundary
**File:** `app/session.tsx`
**Severity:** MEDIUM
**Issue:**
- If recording processing throws, entire session screen crashes
- No error recovery UI
- User has to restart the session

**Impact:**
- Poor user experience with errors
- Impossible to debug with no UI feedback
- Users may abandon feature

**Suggested Fix:**
```typescript
// Wrap critical operations
<ErrorBoundary
  fallback={
    <View style={styles.errorContainer}>
      <Text style={styles.errorText}>Session error</Text>
      <Pressable onPress={handleReload}>
        <Text>Try Again</Text>
      </Pressable>
    </View>
  }
>
  <SessionContent />
</ErrorBoundary>
```

**Ticket:** Create task: "Add error boundary to session screen"

---

## Performance Issues

### 1. No Memoization of Chunk Display
**File:** `app/session.tsx`
**Severity:** MEDIUM
**Issue:**
- Chunks rendered in FlatList without proper key or memo
- Every re-render recreates DisplayWord components
- Waveform re-renders even when not visible

**Impact:**
- Janky scrolling between chunks
- Animation stuttering
- Battery drain

**Suggested Fix:**
```typescript
const ChunkItem = memo(({ chunk, result }: ChunkItemProps) => (
  <VerseCard chunk={chunk} result={result} />
), (prev, next) => prev.chunk.id === next.chunk.id && prev.result === next.result);

<FlatList
  data={listData}
  renderItem={({ item, index }) => (
    <ChunkItem chunk={item as Chunk} result={getChunkResult(index)} />
  )}
  keyExtractor={(item, index) => `${item.id}-${index}`}
  removeClippedSubviews
  maxToRenderPerBatch={2}
  updateCellsBatchingPeriod={50}
/>
```

**Ticket:** Create task: "Optimize chunk rendering with memoization"

---

### 2. Waveform Updates Too Frequently
**File:** `app/session.tsx` (lines ~65-75 estimated)
**Severity:** LOW-MEDIUM
**Issue:**
- Metering callback likely runs every 100ms
- Triggers re-render of entire screen
- Waveform animation runs in parallel

**Impact:**
- Unnecessary re-renders during recording
- Battery drain during long recordings
- Janky UI animations

**Suggested Fix:**
```typescript
// Debounce waveform updates
const startMetering = useCallback(() => {
  let lastUpdate = Date.now();
  
  meteringRef.current = setInterval(async () => {
    if (!recordingRef.current) return;
    
    const metering = await recordingRef.current.getStatusAsync();
    const now = Date.now();
    
    // Only update UI every 200ms
    if (now - lastUpdate > 200) {
      const normalized = Math.min(Math.max((metering.metering || -160) / -160, 0), 1);
      waveformDataRef.current.push(normalized);
      
      if (waveformDataRef.current.length > WAVEFORM_SAMPLES) {
        waveformDataRef.current.shift();
      }
      
      setWaveformTrigger(prev => prev + 1);
      lastUpdate = now;
    }
  }, 50);
}, []);
```

**Ticket:** Create task: "Debounce waveform updates during recording"

---

## Scale Issues

### 1. Transcription Timeout Not Adaptive
**File:** `supabase/functions/process-recording/index.ts` (line 243)
**Severity:** MEDIUM
**Issue:**
- 60-second timeout is hardcoded
- Doesn't account for network quality
- Doesn't account for audio duration
- Single long recording could timeout

**Impact:**
- Users with slow networks fail randomly
- Long verses might timeout
- No way to adjust without app update

**Suggested Fix:**
```typescript
const calculateTimeout = (durationMs: number, networkQuality: 'fast' | 'slow' = 'fast'): number => {
  // Base: 1 second per 10 seconds of audio
  const baseMs = Math.max(30000, durationMs * 1.5); // 30s minimum, 1.5x audio duration
  
  // Adjust for network quality
  const multiplier = networkQuality === 'slow' ? 2 : 1;
  
  // Cap at 2 minutes
  return Math.min(120000, baseMs * multiplier);
};

const maxAttempts = Math.ceil(calculateTimeout(durationMs) / 1000);
```

**Ticket:** Create task: "Make transcription timeout adaptive"

---

### 2. No Streaming for Long Recordings
**File:** `supabase/functions/process-recording/index.ts`
**Severity:** MEDIUM
**Issue:**
- Entire audio file uploaded at once
- Large audio files cause memory spike
- Network interruption requires full retry
- No progress indication

**Impact:**
- Fails for users with slow connections
- High server memory usage
- Poor UX for mobile users

**Suggested Fix:**
```typescript
// Implement chunked upload
async function transcribeWithChunking(audioBlob: Blob, verseText: string, chunkSize: number = 10 * 1024 * 1024) {
  const totalSize = audioBlob.size;
  const chunks = Math.ceil(totalSize / chunkSize);
  
  let uploadedSize = 0;
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const chunk = audioBlob.slice(start, end);
    
    // Upload chunk with retry
    await uploadChunk(chunk, i, chunks);
    uploadedSize = end;
    
    // Report progress
    console.log(`[PROCESS] Upload progress: ${Math.round((uploadedSize / totalSize) * 100)}%`);
  }
}
```

**Ticket:** Create task: "Implement chunked audio upload for large files"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add retry queue for failed progress updates | CRITICAL | Reliability |
| Add submission debouncing to prevent race conditions | CRITICAL | Data Integrity |
| Add comprehensive error handling for recording failures | HIGH | Error Handling |
| Add session persistence and restoration | HIGH | Reliability |
| Refactor use-study-session into smaller focused hooks | HIGH | Code Quality |
| Add error classification to transcription service | MEDIUM | Error Handling |
| Document and test scoring algorithm with unit tests | MEDIUM | Quality/Testing |
| Improve audio resource cleanup with error logging | MEDIUM | Reliability |
| Refactor difficulty system to be extensible | MEDIUM | Future-Proofing |
| Design pluggable scoring algorithm system | MEDIUM | Future-Proofing |
| Design pluggable text chunking system | MEDIUM | Future-Proofing |
| Extract session business logic from React hook | MEDIUM | Architecture |
| Add error boundary to session screen | MEDIUM | Error Handling |
| Optimize chunk rendering with memoization | MEDIUM | Performance |
| Debounce waveform updates during recording | LOW-MEDIUM | Performance |
| Make transcription timeout adaptive | MEDIUM | Scale |
| Implement chunked audio upload for large files | MEDIUM | Scale |

---

## Next Review Section
→ Continue with: `BY_DOMAIN/Analytics-Insights`
