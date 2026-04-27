# Supabase Security Advisor Fixes

## Overview

Supabase Security Advisor flagged several issues. None are critical blockers - the app works fine - but should be addressed before public launch.

---

## ERRORS (High Priority)

### 1. `verse_cache` - RLS Disabled

**What Supabase said:**
> Table `public.verse_cache` is public, but RLS has not been enabled.

**What this table is:**
- Shared Bible text cache (server-side optimization)
- Caches fetched verses to reduce API calls to ESV/NLT APIs
- NOT user data - intentionally shared across all users

**Why no RLS was added (from migration comment):**
> "No RLS - shared cache across all users (server-side optimization)"

**The risk:**
Anyone with your anon key could query `SELECT * FROM verse_cache` via the Supabase API and see cached Bible verses. Not sensitive, but unnecessary exposure.

**Fix:**
Revoke public API access (keep it server-side only):
```sql
REVOKE ALL ON verse_cache FROM anon, authenticated;
```

---

### 2. `app_config` - RLS Disabled

**What Supabase said:**
> Table `public.app_config` is public, but RLS has not been enabled.

**What this table is:**
- Server-side configuration values
- Stores things like `stats_cron_schedule = '0 */6 * * *'` and `stats_min_words = '600'`
- Used by cron jobs and server functions

**The risk:**
Anyone could query config values. Not sensitive, but unnecessary exposure.

**Fix:**
```sql
REVOKE ALL ON app_config FROM anon, authenticated;
```

---

### 3. `verse_cache_stats` - Security Definer View

**What Supabase said:**
> View `public.verse_cache_stats` is defined with the SECURITY DEFINER property. These views enforce Postgres permissions and row level security policies (RLS) of the view creator, rather than that of the querying user.

**What this view is:**
- Shows cache stats per Bible version (verse count, oldest/newest use)
- Defined in `supabase/migrations/004_verse_level_cache.sql`

**The risk:**
Security definer views can bypass RLS. Since this view is on `verse_cache` which has no RLS anyway, it's not a real issue, but Supabase flags it.

**Fix:**
Recreate without SECURITY DEFINER, or just revoke access:
```sql
REVOKE ALL ON verse_cache_stats FROM anon, authenticated;
```

---

## WARNINGS (Lower Priority)

### 4. Functions without `search_path`

**What Supabase said:**
> Function `public.X` has a role mutable search_path

**Affected functions:**
- `get_tier_and_usage`
- `update_updated_at_column`
- `upsert_verses`
- `update_user_stats`
- `get_total_time_studied`
- `get_current_streak`

**What this means:**
When Postgres runs a function, it looks up table names using a "search path" (like `$PATH` in terminal). Without an explicit search path, there's a theoretical attack vector where someone could trick your function into using a malicious table with the same name.

**The risk:**
Very low in practice, but good hygiene.

**Fix:**
Add `SET search_path = ''` to each function:
```sql
CREATE OR REPLACE FUNCTION get_current_streak()
RETURNS INT
LANGUAGE SQL
STABLE
SET search_path = ''  -- Add this line
AS $$
  -- function body using fully qualified names like public.table_name
$$;
```

---

### 5. Leaked Password Protection Disabled

**What Supabase said:**
> Leaked password protection is currently disabled. Supabase Auth prevents the use of compromised passwords by checking against HaveIBeenPwned.org.

**What this means:**
When users sign up or change passwords, Supabase can check if that password has appeared in known data breaches.

**The risk:**
Users might use compromised passwords.

**Fix:**
Enable in Supabase Dashboard:
1. Go to Authentication → Settings
2. Find "Password Protection" section
3. Enable "Check passwords against leaked database"

---

## Migration File to Create

When ready to fix, create `supabase/migrations/014_security_fixes.sql`:

```sql
-- ============================================================================
-- Security Fixes - Address Supabase Security Advisor warnings
-- ============================================================================

-- 1. Hide server-only tables from public API
REVOKE ALL ON verse_cache FROM anon, authenticated;
REVOKE ALL ON app_config FROM anon, authenticated;
REVOKE ALL ON verse_cache_stats FROM anon, authenticated;

-- 2. Fix function search paths
-- (Need to recreate each function with SET search_path = '')

-- get_tier_and_usage
CREATE OR REPLACE FUNCTION public.get_tier_and_usage()
-- ... copy existing function body, add SET search_path = ''

-- update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
-- ... copy existing function body, add SET search_path = ''

-- upsert_verses
CREATE OR REPLACE FUNCTION public.upsert_verses(...)
-- ... copy existing function body, add SET search_path = ''

-- update_user_stats
CREATE OR REPLACE FUNCTION public.update_user_stats()
-- ... copy existing function body, add SET search_path = ''

-- get_total_time_studied
CREATE OR REPLACE FUNCTION public.get_total_time_studied()
-- ... copy existing function body, add SET search_path = ''

-- get_current_streak
CREATE OR REPLACE FUNCTION public.get_current_streak()
-- ... copy existing function body, add SET search_path = ''
```

---

## Summary

| Issue | Type | Risk | Fix |
|-------|------|------|-----|
| `verse_cache` no RLS | ERROR | Low | REVOKE public access |
| `app_config` no RLS | ERROR | Low | REVOKE public access |
| `verse_cache_stats` security definer | ERROR | Low | REVOKE public access |
| 6 functions no search_path | WARN | Very Low | Add SET search_path = '' |
| Leaked password protection | WARN | Medium | Enable in Dashboard |

---

## Notes

- None of these block the app from working
- The "errors" are really just "tables exposed that don't need to be"
- No actual user data is at risk
- Good to fix before App Store launch for best practices
