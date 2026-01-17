# Business Logic & Data Rules - BibleMem

Last updated: 2026-01-17

This document contains ALL business logic, data rules, thresholds, and edge cases for the app.

---

## 1. VERSE & COLLECTION RULES

### Verse Addition Rules
- **Duplicate Prevention**: Verses are unique by `(user_id, book, chapter, verse_start, verse_end, version)`
  - Enforced via unique constraint on `user_verses` table (Migration 006:95-97)
  - Only applies to non-deleted verses (`WHERE deleted_at IS NULL`)
- **Restoration on Re-add**: If a verse exists but is soft-deleted, re-adding restores it
  - Sets `deleted_at = NULL` instead of creating new record
  - Preserves existing progress data
- **Many-to-Many Collections**: Junction table `verse_collections` links verses to collections
  - Constraint: `UNIQUE(verse_id, collection_id)` prevents duplicate memberships
  - Uses upsert with `ignoreDuplicates: true`

### Collection Deletion Rules
- **Cannot Delete Default Collection**: Explicitly prevented (store/index.ts:386)
- **Cascade Behavior** (for each verse in collection):
  1. If verse is in other collections → Remove junction entry only (verse stays)
  2. If verse is mastered (only in this collection) → Soft delete verse (stays in Mastered list)
  3. If verse is not mastered (only in this collection) → Hard delete verse (gone forever)
  4. Collection is soft-deleted (`deleted_at` set)
- **Confirmation Alert**: Shows warning that non-mastered orphan verses will lose progress
- **Soft Delete**: Collections with `deleted_at IS NOT NULL` excluded from queries

### Verse Deletion Rules
- **Partial Deletion**: Removes verse from ONLY the specified collection (not all collections)
- **Full Deletion Logic**:
  - If verse still in other collections: no action on `user_verses`
  - If verse no longer in ANY collection:
    - **Mastered verse**: Soft delete (preserves in Mastered list)
    - **Non-mastered verse**: Hard delete (completely removed)
- **Mastery is Permanent**: Soft-deleted mastered verses remain queryable in Mastered collection

### Client ID System
- **Verse Format**: `{book}-{chapter}-{verseStart}-{verseEnd}-{timestamp}`
- **Collection Format**: `collection-{Date.now()}`
- **Purpose**: Offline-first - assign IDs before server round-trip
- **Stored**: `client_id` TEXT column maps to server UUID

---

## 2. PROGRESS & MASTERY

### Progress JSON Structure
```json
{
  "easy": { "bestAccuracy": null, "completed": false },
  "medium": { "bestAccuracy": null, "completed": false },
  "hard": { "bestAccuracy": null, "completed": false },
  "engraved": { "completed": false, "months": [] }
}
```

### Difficulty Levels
- `easy`, `medium`, `hard`
- Type: `Difficulty = 'easy' | 'medium' | 'hard'`

### Mastery Definition
- **Mastered** = `hard.completed === true`
- **Trigger**: Any hard mode attempt with `accuracy >= 90`
- **Best Score Tracking**: Only updates if new score > previous best

### Progress Update Logic
1. Get current verse and best accuracy for difficulty
2. Only update if:
   - New score > current best, OR
   - Hard mode AND accuracy >= 90 (for engraved tracking)
3. Update best accuracy for difficulty
4. If newly mastered, add to masteredVerses list
5. Write to Supabase

### Engraved Progress (Four Consecutive Months)
- **Definition**: `progress.engraved.completed = true` when 4 consecutive months achieved
- **Trigger**: Hard mode with accuracy >= 90 (once per month sufficient)
- **Tracking**: Array of "YYYY-MM" strings in `progress.engraved.months`
- **Logic**:
  - First entry: add current month
  - Same month: ignore (already logged)
  - Consecutive month: add to streak
  - Gap: reset array, start fresh with current month
- **Completion**: `months.length >= 4`
- **Cap**: Never exceeds 4 elements

### Consecutive Month Logic
```
December → January of next year = consecutive
Same year, month + 1 = consecutive
Anything else = streak broken
```

---

## 3. ANALYTICS CALCULATIONS

### Current Streak
- **Function**: `get_current_streak(user_id, tz_offset_min)`
- **Logic**:
  1. Convert UTC to client's local timezone
  2. Get today and yesterday in local time
  3. Fetch distinct practice dates (descending)
  4. If most recent != today AND != yesterday: return 0 (broken)
  5. Count consecutive days backwards
- **Timezone**: Uses client's offset (`new Date().getTimezoneOffset()`)

### Total Time Studied
- **Function**: `get_total_time_studied(user_id)`
- **Calculation**: `SUM(recording_duration_ms)` from all `session_attempts`
- **Returns**: Milliseconds (BIGINT)
- **No filters**: All attempts included

### Average Time to Master
- **Source**: `user_stats.avg_time_per_word_ms` (precomputed)
- **Calculation** (in cron job):
  1. Find first mastery attempt per verse (hard mode, >= 90%)
  2. Sum all attempts up to mastery for each verse
  3. Calculate: total_time / word_count per verse
  4. Average across all mastered verses
- **Display**: `avg_time_per_word_ms * 23` (typical verse length)
- **Minimum**: Only computed for users with 600+ words mastered
- **Update**: Cron job every 6 hours

### Session Attempts Logged Data
- `book, chapter, verse_start, verse_end, version`
- `difficulty` (easy/medium/hard)
- `chunk_size`
- `accuracy` (0-100)
- `recording_duration_ms` (total across all chunks)
- `word_count`

---

## 4. CACHING (verse_cache)

### Structure
- One row per verse per version
- Unique: `(book, chapter, verse, version)`
- No RLS - shared across all users

### LRU Eviction
- **Max**: 500 verses per version (ESV/NLT licensing requirement)
- **Trigger**: Before inserting new verses
- **Logic**:
  1. Calculate: current + new verses
  2. If over 500: evict oldest by `last_used_at`
  3. Exclude current book+chapter from eviction
- **Update**: `last_used_at` updated on cache hit (fire-and-forget)

### Cache Functions
- `getCachedChapter`: Returns all verses or null (validates completeness)
- `getCachedVerseRange`: Returns concatenated text or null (if any missing)
- `getCachedVerse`: Returns single verse text or null

---

## 5. RATE LIMITING

### Tiers
- `free` | `supporter`

### Daily Limits

| Type | Free | Supporter |
|------|------|-----------|
| Transcribe (seconds) | 300 (5 min) | 3600 (1 hour) |
| Evaluate (count) | 20 | 500 |
| Bible Fetch (count) | 100 | 10,000 |

### Reset
- **When**: Midnight UTC daily
- **Storage**: `usage_daily` table with `UNIQUE(user_id, date)`

### Pattern
- **Before**: `checkTranscriptionUsage()` or `checkEvaluateUsage()`
- **After Success**: `recordTranscriptionUsage()` or `recordEvaluateUsage()`
- **Returns**: `{ allowed, used, limit }`

---

## 6. SYNC & MIGRATION

### Local-to-Server Migration
- **Trigger**: First sign-in or app upgrade
- **Flag**: AsyncStorage `'data_synced_to_server'`
- **Process**:
  1. Check if already migrated
  2. For each local collection: create on server if not exists
  3. Map client_id → server UUID
  4. For each local verse: create or update progress on server
  5. Mark migration complete

### Conflict Handling
- Duplicate errors (code 23505): fetch existing ID instead
- Individual verse errors: continue migration (don't fail whole batch)

---

## 7. KEY THRESHOLDS & CONSTANTS

| Constant | Value | Purpose |
|----------|-------|---------|
| `90` | % | Mastery/completion threshold |
| `4` | months | Engraved consecutive months required |
| `500` | verses | Max cache per version (licensing) |
| `600` | words | Min for avg_time_per_word calculation |
| `23` | words | Typical verse length approximation |
| `300` | seconds | Free tier daily transcription (5 min) |
| `3600` | seconds | Supporter tier daily transcription (1 hr) |
| `6` | hours | Stats cron job interval |
| `'my-verses'` | ID | Default collection ID |
| `'mastered'` | ID | Virtual mastered collection ID |

---

## 8. DATABASE UNIQUE CONSTRAINTS

| Table | Constraint |
|-------|-----------|
| `user_verses` | `(user_id, book, chapter, verse_start, verse_end, version)` WHERE `deleted_at IS NULL` |
| `user_verses` | `(user_id, client_id)` |
| `user_collections` | `(user_id, client_id)` |
| `verse_collections` | `(verse_id, collection_id)` |
| `usage_daily` | `(user_id, date)` |
| `subscriptions` | `(user_id)` |
| `verse_cache` | `(book, chapter, verse, version)` |

---

## 9. EDGE CASES & SPECIAL LOGIC

### Soft Delete Behavior
- **Mastered Verses**: Soft-deleted but remain queryable (no `deleted_at` filter)
- **Non-Mastered Verses**: Hard deleted when removed from all collections
- **Collections**: Soft-deleted, verses reassigned to default first

### Duplicate Handling
- **Re-adding Existing Verse**: Restores `deleted_at = NULL`
- **Junction Table**: Upsert with `ignoreDuplicates: true`
- **Unique Constraint**: Includes soft-deleted check to prevent orphans

### Engraved Streak Breaking
- Any month gap resets array before adding current month
- Single 90%+ attempt per month is sufficient
- Duplicate months ignored

### Progress Update Optimization
- Only writes if: new best score OR (hard mode + >= 90)
- Engraved updates don't block on failure (optimistic)

### Collection Deletion Guarantees
- Default collection cannot be deleted (silent no-op)
- All verses relocated before soft-delete
- Mastered verses preserved even if collection deleted

---

## 10. SUMMARY OF KEY BUSINESS RULES

1. **Mastery**: Hard mode >= 90% accuracy
2. **Engraved**: 4 consecutive months of any hard-mode 90%+ attempt
3. **Duplication**: Prevented by unique constraint on (user, book, chapter, verse range, version)
4. **Soft Delete**: Mastered verses preserved when removed from collections
5. **Streak**: Consecutive calendar days with any session attempt (timezone-aware)
6. **Rate Limits**: Daily per-user, reset at midnight UTC, tier-based
7. **Cache**: Max 500 verses per version, LRU eviction
8. **Sync**: Client-side IDs generated offline, migrated on first auth
9. **Time to Mastery**: Avg ms per word (min 600 words required)
10. **Many-to-Many**: Verses can be in multiple collections
