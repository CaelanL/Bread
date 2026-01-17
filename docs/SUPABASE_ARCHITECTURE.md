# Supabase Architecture - BibleMem

Last updated: 2026-01-17

## Overview

This document maps every Supabase component, its purpose, and where it's used in the codebase.

---

## Tables

### Core User Data

| Table | Purpose | Used By |
|-------|---------|---------|
| `user_collections` | User's verse collections (folders) | `lib/store/index.ts`, `lib/storage/index.ts` |
| `user_verses` | User's saved verses with progress | `lib/store/index.ts`, `lib/storage/index.ts` |
| `verse_collections` | Junction: verse ↔ collection (many-to-many) | `lib/store/index.ts` |
| `user_stats` | Precomputed analytics (avg time to master) | `lib/api/analytics.ts`, cron job |

### Analytics & Usage

| Table | Purpose | Used By |
|-------|---------|---------|
| `session_attempts` | Every practice session (for streaks, accuracy) | `lib/api/analytics.ts` |
| `usage_daily` | Daily API usage limits per user | `supabase/functions/_shared/usage.ts` |
| `subscriptions` | User tier (free/supporter) | `supabase/functions/_shared/auth.ts` |
| `app_config` | App-wide settings (cron schedule, thresholds) | `update_user_stats()` function |

### Caching

| Table | Purpose | Used By |
|-------|---------|---------|
| `verse_cache` | Cached Bible verses (LRU, max 500/version) | `supabase/functions/bible/cache.ts` |
| `verse_cache_stats` | VIEW: Stats per version | Dashboard monitoring |

### Features

| Table | Purpose | Used By |
|-------|---------|---------|
| `verse_of_month` | Monthly verse challenge | `lib/api/votm.ts`, `app/(tabs)/home.tsx` |

---

## Database Functions

### Active Functions

| Function | Purpose | Called By |
|----------|---------|-----------|
| `get_current_streak(user_id, tz_offset)` | Calculate practice streak | `lib/api/analytics.ts` |
| `get_total_time_studied(user_id)` | Sum all recording durations | `lib/api/analytics.ts` |
| `get_tier_and_usage(user_id, date, type)` | Get user tier + daily usage | `supabase/functions/_shared/usage.ts` |
| `update_user_stats()` | Recalculate avg time to master | Cron job (every 6 hours) |
| `update_updated_at_column()` | Auto-update timestamps | Triggers on `user_collections`, `user_verses` |
| `upsert_verses(book, chapter, version, verses)` | Batch insert/update cache | `supabase/functions/bible/cache.ts` |

---

## Edge Functions

Located in `supabase/functions/`

### `bible/index.ts`
**Purpose:** Fetch Bible verses from external APIs (ESV, API.Bible)

**Endpoints:**
- `GET /bible?ref=John+3:16&version=ESV` - Single verse
- `GET /bible?ref=John+3&chapter=true` - Full chapter

**Flow:**
1. Auth check
2. Rate limit check (`checkAndIncrementBibleUsage`)
3. Check `verse_cache`
4. If miss: fetch from ESV/API.Bible adapter
5. Cache result
6. Return verse text

**Tables Used:** `verse_cache`, `usage_daily`, `subscriptions`

### `process-recording/index.ts`
**Purpose:** Transcribe audio recordings via Soniox

**Endpoints:**
- `POST /process-recording` - Upload audio, get transcription

**Flow:**
1. Auth check (JWT verification)
2. Parse multipart form (audio file, duration, verse text)
3. Upload to Soniox → Create job → Poll → Get transcript
4. Record usage (`recordTranscriptionUsage`)
5. Return transcription

**Tables Used:** `usage_daily`

**Note:** Has cleaning via OpenAI but currently disabled (`CLEANING_ENABLED = false`)

### Shared Modules (`_shared/`)

| File | Purpose |
|------|---------|
| `auth.ts` | JWT verification, get user tier from `subscriptions` |
| `usage.ts` | Rate limiting, usage tracking in `usage_daily` |
| `cors.ts` | CORS headers |
| `errors.ts` | Standard error responses |

---

## Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `update_user_collections_updated_at` | `user_collections` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_user_verses_updated_at` | `user_verses` | BEFORE UPDATE | `update_updated_at_column()` |

---

## Cron Jobs

| Job Name | Schedule | Function | Purpose |
|----------|----------|----------|---------|
| `update-user-stats` | `0 */6 * * *` (every 6 hours) | `update_user_stats()` | Recalculate avg time to master per word |

---

## Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `Files` | VOTM background images | Public |

---

## RLS Policies Summary

| Table | RLS | Policies |
|-------|-----|----------|
| `app_config` | ❌ Disabled | None (admin only via dashboard) |
| `session_attempts` | ✅ Enabled | Users: SELECT, INSERT own |
| `subscriptions` | ✅ Enabled | Users: SELECT own; Service: ALL |
| `usage_daily` | ✅ Enabled | Users: SELECT own; Service: ALL |
| `user_collections` | ✅ Enabled | Users: SELECT, INSERT, UPDATE own; Service: ALL |
| `user_stats` | ✅ Enabled | Users: SELECT own |
| `user_verses` | ✅ Enabled | Users: SELECT, INSERT, UPDATE own; Service: ALL |
| `verse_cache` | ❌ Disabled | Shared cache (server-side only) |
| `verse_collections` | ✅ Enabled | Users: SELECT, INSERT, DELETE own; Service: ALL |
| `verse_of_month` | ✅ Enabled | Anyone: SELECT |

---

## Data Flow Diagrams

### 1. User Auth Flow
```
App → Supabase Auth → JWT token stored locally
     ↓
On API calls: JWT sent in Authorization header
     ↓
Edge functions verify JWT via `verifyJwt()` or `getAuthUser()`
```

### 2. Verse Fetching Flow
```
App requests verse (lib/api/bible.ts)
     ↓
Edge function /bible
     ↓
Check verse_cache → HIT → Return cached
     ↓ MISS
Fetch from ESV API or API.Bible
     ↓
Store in verse_cache (LRU, max 500/version)
     ↓
Return to app
```

### 3. Practice Session Flow
```
User records verse recitation
     ↓
App sends audio to /process-recording
     ↓
Soniox transcribes → Returns text
     ↓
App compares transcription to actual verse (client-side diff)
     ↓
App logs to session_attempts
     ↓
App updates user_verses.progress
```

### 4. Analytics Flow
```
Insights screen loads
     ↓
getCurrentStreak() → RPC get_current_streak() → Returns streak count
getTotalTimeStudied() → RPC get_total_time_studied() → Returns ms
getAvgTimeToMaster() → Query user_stats table (precomputed by cron)
```

---

## Security Notes

1. **RLS Disabled on `app_config`** - OK, it's admin-only config
2. **RLS Disabled on `verse_cache`** - OK, shared cache with no user data
3. **No DELETE policy on `user_verses`** - Users can't delete verses directly (soft delete via `deleted_at`)
4. **No DELETE policy on `session_attempts`** - Analytics are permanent

---

## Migration History

| Migration | Description |
|-----------|-------------|
| 001_initial.sql | usage_daily, transcription_locks, subscriptions, verse_cache |
| 002_user_data.sql | user_collections, user_verses, triggers |
| 003_chapter_cache.sql | chapter_cache (later replaced) |
| 004_verse_level_cache.sql | Replaced chapter_cache with verse-level LRU |
| 005_user_verses_no_text.sql | Removed text from user_verses |
| 006_verse_collections_junction.sql | Many-to-many verses ↔ collections |
| 007_verse_of_month.sql | VOTM table |
| 008_votm_image.sql | Added image_url to VOTM |
| 009_session_attempts.sql | Analytics table |
| 010_add_word_count.sql | word_count column for analytics |
| 011_user_stats_cron.sql | user_stats table + cron job |
| 012_analytics_functions.sql | get_current_streak, get_total_time_studied |
