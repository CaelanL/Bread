[STATUS: review_done_needs_followup]

# Analytics-Insights Domain Review

## Summary
The Analytics-Insights domain tracks user engagement with a well-designed database schema and cron-based stats aggregation. However, there are significant concerns around timezone handling, calculation correctness, data consistency, error handling, and the ability to scale to thousands of concurrent users.

---

## Critical Issues

### 1. Timezone Bug in Streak Calculation
**File:** `lib/api/analytics.ts` (lines ~62-107)
**Severity:** CRITICAL
**Issue:**
```typescript
// Get unique dates in user's local timezone
const uniqueDates = [...new Set(
  data.map(row => getLocalDateString(new Date(row.created_at)))
)].sort().reverse();
```
- `created_at` is stored as UTC in Supabase
- Converting to local Date object loses user's timezone context
- User in UTC-5 practicing at 11 PM on Jan 1 gets counted in UTC timezone on Jan 2
- Streak calculation differs based on server time vs client time
- After midnight UTC, streak might appear broken to user (but then fixed when client time advances)

**Impact:**
- Streaks appear/disappear based on timezone
- Inconsistent streak display across different client times
- User confusion ("Why did my streak reset?")
- Different users see different streaks for same session data

**Suggested Fix:**
```typescript
// Store user's timezone preference
interface UserPreferences {
  timezone: string; // "America/New_York"
}

function getLocalDateString(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export async function getCurrentStreak(userTimezone?: string): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  
  const timezone = userTimezone || 'UTC';
  
  const { data, error } = await supabase
    .from('session_attempts')
    .select('created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  
  if (error || !data || data.length === 0) return 0;
  
  // Use user's timezone for date calculations
  const uniqueDates = [...new Set(
    data.map(row => getLocalDateString(new Date(row.created_at), timezone))
  )].sort().reverse();
  
  // ... rest of logic
}
```

**Ticket:** Create task: "Fix timezone handling in streak calculation"

---

### 2. Stats Aggregation May Skip Sessions
**File:** `supabase/migrations/011_user_stats_cron.sql` (lines ~52-59)
**Severity:** CRITICAL
**Issue:**
```sql
SELECT DISTINCT ON (user_id, book, chapter, verse_start, verse_end, version)
  user_id,
  word_count
FROM session_attempts
WHERE difficulty = 'hard' AND accuracy >= 90 AND word_count IS NOT NULL
ORDER BY user_id, book, chapter, verse_start, verse_end, version, created_at
```
- Uses `DISTINCT ON` which arbitrarily picks one row per verse combination
- If user re-attempts same verse, only one mastery is counted
- But if same attempt is in database multiple times (duplicate insert), counts as single mastery (correct by accident)
- The query assumes `word_count IS NOT NULL`, but some verses might have NULL word_count
- Those verses are silently skipped from stats

**Impact:**
- Inaccurate mastery counts
- Verses with NULL word_count excluded from "words mastered"
- Stats not representative of actual progress
- User sees deflated statistics

**Suggested Fix:**
```sql
-- Only count unique verse masteries (first time hitting 90%+ on hard)
WITH first_masteries AS (
  SELECT DISTINCT ON (user_id, book, chapter, verse_start, verse_end, version)
    user_id,
    book, chapter, verse_start, verse_end, version,
    created_at,
    word_count,
    ROW_NUMBER() OVER (PARTITION BY user_id, book, chapter, verse_start, verse_end, version ORDER BY created_at) as attempt_num
  FROM session_attempts
  WHERE difficulty = 'hard' AND accuracy >= 90
  ORDER BY user_id, book, chapter, verse_start, verse_end, version, created_at
),
mastered_verses AS (
  SELECT
    user_id,
    COALESCE(SUM(word_count), 0) as total_words,
    COUNT(*) as verses_count
  FROM first_masteries
  WHERE word_count > 0  -- Only count verses with known word count
  GROUP BY user_id
)
-- Use mastered_verses for updates
```

**Ticket:** Create task: "Fix stats aggregation to handle NULL word_count and verify uniqueness"

---

### 3. No Error Recovery for Cron Job Failures
**File:** `supabase/migrations/011_user_stats_cron.sql` (lines ~32-112)
**Severity:** HIGH
**Issue:**
- If cron job fails midway, some users' stats are updated but others aren't
- No transaction wrapping the entire function
- `UPDATE user_stats s SET ... FROM user_averages ua` could fail for some users
- No retry mechanism if Supabase has temporary issues
- No logging of failures visible to admins

**Impact:**
- Stale stats for subset of users
- Inconsistent user experience
- No way to debug which users missed updates
- Stats diverge from actual data over time

**Suggested Fix:**
```sql
-- Wrap in transaction with proper error handling
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS TABLE(success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  min_words INT;
  update_count INT := 0;
  error_msg TEXT;
BEGIN
  BEGIN
    -- Transaction starts automatically
    
    -- ... existing logic ...
    
    -- Log success
    INSERT INTO audit_log (event_type, details) 
    VALUES ('stats_cron_success', jsonb_build_object(
      'users_updated', update_count,
      'timestamp', NOW()
    ));
    
    RETURN QUERY SELECT true, NULL::text;
    
  EXCEPTION WHEN OTHERS THEN
    error_msg := SQLERRM;
    
    -- Log error
    INSERT INTO audit_log (event_type, details)
    VALUES ('stats_cron_error', jsonb_build_object(
      'error', error_msg,
      'timestamp', NOW()
    ));
    
    -- Rollback happens automatically
    RETURN QUERY SELECT false, error_msg;
  END;
END;
$$;
```

**Ticket:** Create task: "Add transaction safety and error logging to stats cron"

---

## Code Quality Issues

### 1. Streak Calculation Inefficient with Large Datasets
**File:** `lib/api/analytics.ts` (lines ~62-107)
**Severity:** HIGH
**Issue:**
```typescript
// Fetches ALL sessions for user, then filters client-side
const { data, error } = await supabase
  .from('session_attempts')
  .select('created_at')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });
```
- Fetches all session records for user (could be 10,000+)
- Processes in JavaScript memory
- With 1000 users × 100 sessions = 100k records on home screen load
- Blocks UI during date deduplication and streak calculation

**Impact:**
- Slow home screen load (timeout)
- High bandwidth usage
- Memory pressure on mobile devices
- Poor performance with heavy users

**Suggested Fix:**
Move computation to database:
```typescript
export async function getCurrentStreak(userTimezone?: string): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  
  // Use database to calculate streak (runs at server speed)
  const { data, error } = await supabase.rpc('calculate_current_streak', {
    user_id: user.id,
    timezone: userTimezone || 'UTC'
  });
  
  if (error || !data) return 0;
  return data.streak;
}

// In database (PostgreSQL function)
CREATE OR REPLACE FUNCTION calculate_current_streak(
  p_user_id UUID,
  p_timezone TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_streak INT := 0;
BEGIN
  -- Database processes dates in user's timezone
  -- Much faster than client-side processing
  -- ...
END;
$$ LANGUAGE plpgsql;
```

**Ticket:** Create task: "Move streak calculation to database function"

---

### 2. No Error Handling for Failed Analytics Calls
**File:** `lib/api/analytics.ts`, `app/(tabs)/insights.tsx`
**Severity:** MEDIUM
**Issue:**
```typescript
// In logSessionAttempt (line 53-55)
if (error) {
  console.error('[ANALYTICS] Failed to log session attempt:', error);
  // Silently fails - doesn't notify user or UI
}

// In insights.tsx (line 125-127)
useEffect(() => {
  getTotalTimeStudied().then(setTimeStudiedMs);
  getAvgTimeToMaster().then(setAvgTimeToMasterMs);
}, []);
// No error handling if APIs fail
```
- Analytics failures silently ignored
- UI doesn't show if stats are stale/missing
- User thinks they have 0 verses mastered when API failed
- No way to retry failed fetches

**Impact:**
- Misleading statistics displayed
- User confusion ("My stats disappeared")
- No indication that data is unavailable
- Session data lost if API fails

**Suggested Fix:**
```typescript
export interface SessionAttemptData {
  // ... existing fields
}

export async function logSessionAttempt(data: SessionAttemptData): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error('[ANALYTICS] Not authenticated');
    return false;
  }

  try {
    const { error } = await supabase.from('session_attempts').insert({
      user_id: user.id,
      // ... fields
    });

    if (error) {
      // Classify error
      if (error.message.includes('network')) {
        console.warn('[ANALYTICS] Network error, will retry');
        // Queue for retry
      } else if (error.message.includes('UNIQUE violation')) {
        console.warn('[ANALYTICS] Duplicate attempt, skipping');
      } else {
        console.error('[ANALYTICS] Failed to log:', error);
      }
      return false;
    }
    return true;
  } catch (error) {
    console.error('[ANALYTICS] Exception:', error);
    return false;
  }
}

// In UI
export default function InsightsScreen() {
  const [timeStudiedMs, setTimeStudiedMs] = useState(0);
  const [statsError, setStatsError] = useState<string | null>(null);
  
  useEffect(() => {
    const loadStats = async () => {
      try {
        const time = await getTotalTimeStudied();
        setTimeStudiedMs(time);
        setStatsError(null);
      } catch (error) {
        setStatsError('Failed to load statistics');
      }
    };
    
    loadStats();
  }, []);
  
  if (statsError) {
    return <Text style={styles.error}>⚠️ {statsError}</Text>;
  }
  
  // ... rest of component
}
```

**Ticket:** Create task: "Add error handling and retry logic to analytics calls"

---

### 3. No Validation of Analytics Data Quality
**File:** `lib/api/analytics.ts`
**Severity:** MEDIUM
**Issue:**
- Accepts any accuracy value from 0-100+ without validation
- Accepts any recording duration without bounds checking
- No validation that book/chapter/verse values are valid
- User could theoretically submit accuracy of 999% (API/DB doesn't reject)

**Impact:**
- Garbage data in analytics database
- Stats become unreliable
- Debugging difficult when data is corrupt

**Suggested Fix:**
```typescript
export interface SessionAttemptData {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: string;
  difficulty: Difficulty;
  chunkSize: number;
  accuracy: number;
  recordingDurationMs?: number;
  wordCount?: number;
}

function validateSessionAttempt(data: SessionAttemptData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data.book || data.book.trim().length === 0) errors.push('Book required');
  if (data.chapter < 1) errors.push('Chapter must be >= 1');
  if (data.verseStart < 1) errors.push('Verse start must be >= 1');
  if (data.verseEnd < data.verseStart) errors.push('Verse end must be >= start');
  if (!['ESV', 'NLT', 'KJV'].includes(data.version)) errors.push('Invalid version');
  if (!['easy', 'medium', 'hard'].includes(data.difficulty)) errors.push('Invalid difficulty');
  if (data.chunkSize < 1) errors.push('Chunk size must be >= 1');
  if (data.accuracy < 0 || data.accuracy > 100) errors.push('Accuracy must be 0-100');
  if (data.recordingDurationMs && data.recordingDurationMs < 0) errors.push('Duration must be >= 0');
  if (data.recordingDurationMs && data.recordingDurationMs > 3600000) errors.push('Duration exceeds 1 hour');
  if (data.wordCount && (data.wordCount < 1 || data.wordCount > 500)) errors.push('Word count must be 1-500');
  
  return { valid: errors.length === 0, errors };
}

export async function logSessionAttempt(data: SessionAttemptData): Promise<boolean> {
  const validation = validateSessionAttempt(data);
  if (!validation.valid) {
    console.error('[ANALYTICS] Invalid data:', validation.errors);
    return false;
  }
  
  // ... proceed with insert
}
```

**Ticket:** Create task: "Add session attempt data validation"

---

## Future-Proofing Issues

### 1. No Support for Historical Trends
**File:** All analytics files
**Severity:** HIGH
**Issue:**
- Only tracks current stats (today's streak, total mastered)
- No historical data (stats over time)
- Can't show "mastered X verses this week"
- Can't compare performance trends

**Impact:**
- Limited insights available to users
- Can't identify if user is becoming more/less active
- Can't show motivation via trend lines
- Feature requests for "see my progress over time" can't be implemented

**Suggested Fix:**
```typescript
// Add daily snapshot table
CREATE TABLE user_stats_daily (
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  verses_mastered INT,
  streak INT,
  total_time_studied_ms INT,
  avg_accuracy DECIMAL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

// Query historical trends
export async function getStatsHistory(
  userId: string, 
  days: number = 30
): Promise<DailyStats[]> {
  const { data } = await supabase
    .from('user_stats_daily')
    .select('*')
    .eq('user_id', userId)
    .gte('date', new Date(Date.now() - days * 86400000).toISOString().split('T')[0])
    .order('date', { ascending: true });
  
  return data || [];
}

// UI can show trend chart
<LineChart data={statsHistory} />
```

**Ticket:** Create task: "Implement daily stats snapshots for historical trends"

---

### 2. No Comparative Analytics
**File:** All analytics files
**Severity:** MEDIUM
**Issue:**
- Only shows personal stats
- No comparison to other users, global averages, or benchmarks
- No achievement levels or badges
- No leaderboards or community engagement

**Impact:**
- Limited motivation for continued engagement
- Competitive users have no benchmarks
- Can't build social/community features

**Suggested Fix:**
```typescript
// Add percentile calculations
export async function getUserPercentile(userId: string): Promise<number | null> {
  const { data } = await supabase.rpc('calculate_user_percentile', {
    p_user_id: userId
  });
  
  // Returns percentile (0-100) of user vs all users
  return data?.percentile || null;
}

// Example: "You're in the top 25% of users"
const percentile = await getUserPercentile(userId);
if (percentile) {
  const tier = percentile > 75 ? 'top 25%' : percentile > 50 ? 'top 50%' : 'top 75%';
  // Show achievement
}
```

**Ticket:** Create task: "Add comparative analytics and achievement system"

---

### 3. Analytics Not Extensible for Custom Metrics
**File:** All analytics files
**Severity:** MEDIUM
**Issue:**
- Hardcoded metrics (streak, mastered, time, avg time)
- Adding new metric requires code changes everywhere
- Can't support per-collection analytics
- Can't support custom goals/challenges

**Impact:**
- Limited feature set
- Hard to experiment with new metrics
- Can't support user-defined goals

**Suggested Fix:**
```typescript
// Define metrics as composable functions
interface MetricDefinition {
  id: string;
  name: string;
  calculate: (userId: string) => Promise<number>;
  format?: (value: number) => string;
  icon?: string;
}

const METRICS: Record<string, MetricDefinition> = {
  streak: {
    id: 'streak',
    name: 'Current Streak',
    calculate: getCurrentStreak,
    format: (v) => `${v} days`,
    icon: 'flame.fill',
  },
  versesMastered: {
    id: 'versesMastered',
    name: 'Verses Mastered',
    calculate: getVersesMastered,
    format: (v) => `${v}`,
    icon: 'checkmark.circle.fill',
  },
};

// Register custom metrics
export function registerMetric(metric: MetricDefinition) {
  METRICS[metric.id] = metric;
}

// Load all metrics dynamically
export async function getUserMetrics(userId: string): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  
  for (const [id, metric] of Object.entries(METRICS)) {
    try {
      results[id] = await metric.calculate(userId);
    } catch (error) {
      console.warn(`Failed to calculate ${id}:`, error);
    }
  }
  
  return results;
}
```

**Ticket:** Create task: "Design extensible metrics system"

---

## Performance Issues

### 1. Stats Not Cached, Refetched on Every Screen Visit
**File:** `app/(tabs)/insights.tsx` (lines ~125-128), `components/home/InsightsCard.tsx`
**Severity:** MEDIUM
**Issue:**
```typescript
useEffect(() => {
  getTotalTimeStudied().then(setTimeStudiedMs);
  getAvgTimeToMaster().then(setAvgTimeToMasterMs);
}, []);
// Runs on every navigation to insights screen
```
- No caching of analytics data
- Each visit to insights tab fetches fresh data
- If user navigates to home → library → home, fetches streak again
- Could hammer server if user rapidly switches tabs

**Impact:**
- Unnecessary API calls
- Slow screen transitions
- Server load increases
- Poor mobile performance

**Suggested Fix:**
```typescript
// Add caching with time-to-live
interface CachedMetric {
  value: number;
  timestamp: number;
  ttl: number;
}

const metricCache = new Map<string, CachedMetric>();

function isCacheValid(cached: CachedMetric): boolean {
  return Date.now() - cached.timestamp < cached.ttl;
}

export async function getTotalTimeStudiedCached(): Promise<number> {
  const cached = metricCache.get('totalTimeStudied');
  
  if (cached && isCacheValid(cached)) {
    return cached.value;
  }
  
  const value = await getTotalTimeStudied();
  metricCache.set('totalTimeStudied', {
    value,
    timestamp: Date.now(),
    ttl: 60000, // 1 minute
  });
  
  return value;
}

// In store, invalidate cache on data refresh
export const useAppStore = create<AppState>((set, get) => ({
  refresh: async () => {
    metricCache.clear(); // Clear cache before refresh
    // ... rest of refresh logic
  },
}));
```

**Ticket:** Create task: "Add caching layer to analytics API calls"

---

### 2. Avatar Spinner Animation Runs Continuously
**File:** `app/(tabs)/home.tsx` (lines ~24-44 estimated)
**Severity:** LOW-MEDIUM
**Issue:**
- Skeleton card has pulsing animation that runs even when not visible
- Animation continues if user navigates away
- Multiple skeleton cards animate simultaneously

**Impact:**
- Battery drain on mobile
- CPU usage during loading
- Janky scroll performance

**Suggested Fix:**
```typescript
function SkeletonCard({ isDark }: { isDark: boolean }) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!isVisible) return; // Don't animate if not visible
    
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    
    return () => pulse.stop();
  }, [isVisible]);

  // Stop animation when component unmounts
  useEffect(() => {
    return () => {
      pulseAnim.setValue(0.4); // Reset
    };
  }, []);

  return (
    <View onLayout={() => setIsVisible(true)}>
      {/* ... rest */}
    </View>
  );
}
```

**Ticket:** Create task: "Optimize skeleton animation performance"

---

## Scale Issues

### 1. Cron Job Doesn't Scale with User Count
**File:** `supabase/migrations/011_user_stats_cron.sql`
**Severity:** HIGH
**Issue:**
- Cron job runs every 6 hours on ALL users
- With 100k users, query joins session_attempts 200k+ times (DISTINCT ON per user)
- No pagination or batching
- If one user has 100k sessions, query stalls

**Impact:**
- Slow cron runs that lock tables
- Stats not updated within 6-hour window
- Other queries affected during cron execution
- Can't scale beyond ~10k users

**Suggested Fix:**
```sql
-- Batch processing approach
CREATE OR REPLACE FUNCTION update_user_stats_batch(
  p_batch_size INT DEFAULT 100
)
RETURNS TABLE(users_processed INT, next_offset INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_size INT := p_batch_size;
  v_offset INT := 0;
  v_total_processed INT := 0;
BEGIN
  LOOP
    -- Process one batch at a time
    INSERT INTO user_stats (user_id, total_words_mastered, updated_at)
    SELECT
      user_id,
      COALESCE(SUM(word_count), 0),
      NOW()
    FROM (
      SELECT DISTINCT ON (user_id) user_id
      FROM session_attempts
      WHERE (updated_at IS NULL OR updated_at < NOW() - INTERVAL '6 hours')
      ORDER BY user_id
      LIMIT v_batch_size OFFSET v_offset
    ) batch_users
    GROUP BY user_id
    ON CONFLICT (user_id) DO UPDATE SET
      updated_at = NOW();
    
    v_total_processed := v_total_processed + v_batch_size;
    
    IF (SELECT COUNT(*) FROM session_attempts 
        WHERE updated_at IS NULL) = 0 THEN
      EXIT;
    END IF;
    
    v_offset := v_offset + v_batch_size;
  END LOOP;
  
  RETURN QUERY SELECT v_total_processed, v_offset;
END;
$$;

-- Call periodically instead of all at once
-- Run every 5 minutes with smaller batches
```

**Ticket:** Create task: "Implement batched stats processing for scalability"

---

### 2. No Query Indexes on Analytics Queries
**File:** `supabase/migrations/011_user_stats_cron.sql`
**Severity:** HIGH
**Issue:**
- Queries on session_attempts filter by user_id, created_at, difficulty
- Without indexes, full table scans on every query
- With millions of records, queries become O(n)

**Impact:**
- Slow analytics page load
- Streak calculation timeout
- Database CPU maxed out

**Suggested Fix:**
```sql
-- Add strategic indexes
CREATE INDEX idx_session_attempts_user_id_created_at 
ON session_attempts(user_id, created_at DESC);

CREATE INDEX idx_session_attempts_user_id_difficulty_accuracy
ON session_attempts(user_id, difficulty, accuracy)
WHERE accuracy >= 90;

CREATE INDEX idx_user_stats_updated_at
ON user_stats(updated_at);

-- Analyze to update statistics
ANALYZE session_attempts;
```

**Ticket:** Create task: "Add database indexes for analytics queries"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Fix timezone handling in streak calculation | CRITICAL | Data Integrity |
| Fix stats aggregation to handle NULL word_count | CRITICAL | Data Integrity |
| Add transaction safety and error logging to stats cron | HIGH | Reliability |
| Move streak calculation to database function | HIGH | Performance |
| Add error handling and retry logic to analytics calls | MEDIUM | Error Handling |
| Add session attempt data validation | MEDIUM | Quality |
| Implement daily stats snapshots for historical trends | HIGH | Future-Proofing |
| Add comparative analytics and achievement system | MEDIUM | Future-Proofing |
| Design extensible metrics system | MEDIUM | Future-Proofing |
| Add caching layer to analytics API calls | MEDIUM | Performance |
| Optimize skeleton animation performance | LOW-MEDIUM | Performance |
| Implement batched stats processing for scalability | HIGH | Scale |
| Add database indexes for analytics queries | HIGH | Scale |

---

## Next Review Section
→ Continue with: `BY_DOMAIN/Settings`
