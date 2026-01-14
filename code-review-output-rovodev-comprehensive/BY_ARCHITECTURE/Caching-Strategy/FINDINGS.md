[STATUS: review_done_needs_followup]

# Caching-Strategy Architecture Review

## Summary
Current caching is ad-hoc with no unified strategy. Bible verses cached in database, session data in memory, but no coherent cache invalidation or warming strategy.

---

## Critical Issues

### 1. No Cache Invalidation Strategy
**Severity:** CRITICAL
**Issue:**
- Bible cache has no TTL
- Session cache never cleaned
- Stale data served indefinitely

**Impact:**
- Outdated information
- Growing memory/storage

**Suggested Fix:**
Implement cache layers:
- L1 (Memory): Session cache, 5 min TTL
- L2 (Device): AsyncStorage cache, 24 hour TTL  
- L3 (Server): Database cache, 90 day TTL

**Ticket:** Create task: "Implement tiered caching strategy with TTLs"

---

### 2. No Cache Warming
**Severity:** MEDIUM
**Issue:**
- Popular verses fetched on-demand only
- Cold starts slow
- No preloading strategy

**Impact:**
- Slow performance on first use
- Poor UX

**Suggested Fix:**
Preload common verses on app startup.

**Ticket:** Create task: "Add cache warming for frequently accessed data"

---

### 3. No Cache Invalidation API
**Severity:** MEDIUM
**Issue:**
- No way to purge cache on demand
- Can't fix stale data manually

**Impact:**
- Stale data problem unsolvable

**Suggested Fix:**
Add cache management endpoints.

**Ticket:** Create task: "Add cache invalidation and management endpoints"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Implement tiered caching strategy with TTLs | CRITICAL | Reliability |
| Add cache warming for frequently accessed data | MEDIUM | Performance |
| Add cache invalidation and management endpoints | MEDIUM | Operations |
