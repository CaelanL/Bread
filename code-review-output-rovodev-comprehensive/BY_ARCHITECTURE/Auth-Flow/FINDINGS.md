[STATUS: review_done_needs_followup]

# Auth-Flow Architecture Review

## Summary
The authentication flow uses Supabase Auth well with proper context-based management. However, there are critical concerns around token refresh strategy, session persistence, logout cleanup, and lack of offline auth support.

---

## Critical Issues

### 1. No Token Refresh Strategy
**Severity:** CRITICAL
**Issue:**
- Tokens fetched once on login, never refreshed
- After token expiry (~1 hour), API calls silently fail
- No automatic token refresh mechanism
- User forced to re-login

**Impact:**
- App becomes unusable after 1 hour
- User confusion
- Poor UX

**Suggested Fix:**
```typescript
// Implement token refresh
export const setupTokenRefresh = () => {
  const refreshInterval = setInterval(async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error('[AUTH] Token refresh failed:', error);
        // Force re-login
      }
    } catch (e) {
      console.error('[AUTH] Token refresh error:', e);
    }
  }, 50 * 60 * 1000); // Refresh every 50 minutes
  
  return () => clearInterval(refreshInterval);
};
```

**Ticket:** Create task: "Implement automatic token refresh mechanism"

---

### 2. Race Condition on Auth State Change
**Severity:** HIGH
**Issue:**
- If user logs in, navigation race condition possible
- If auth context updates while navigation happening, user navigated to wrong screen
- No synchronization between auth state and navigation state

**Impact:**
- User navigated incorrectly
- Confusing UX

**Suggested Fix:**
Use navigation state guard to prevent race conditions.

**Ticket:** Create task: "Add auth state synchronization with navigation"

---

### 3. No Offline Auth Support
**Severity:** MEDIUM
**Issue:**
- If auth service down, app can't initialize
- No fallback to anonymous mode
- User completely blocked

**Impact:**
- App unusable if auth down
- Poor resilience

**Suggested Fix:**
```typescript
// Add offline support
if (!hasNetworkConnection) {
  // Use locally stored auth state
  const cachedAuth = await AsyncStorage.getItem('cached_auth');
  if (cachedAuth) {
    useAuthContext.setState(JSON.parse(cachedAuth));
    setOfflineMode(true);
  } else {
    allowAnonymousMode(); // Limited functionality
  }
}
```

**Ticket:** Create task: "Add offline auth fallback and cached session support"

---

## Code Quality Issues

### 1. Session State Not Verified on Startup
**Severity:** MEDIUM
**Issue:**
- App assumes cached session is still valid
- No verification that token still works
- Silent auth failure possible

**Impact:**
- User appears logged in but API calls fail
- Confusing UX

**Suggested Fix:**
Verify token validity on app startup.

**Ticket:** Create task: "Add session validity check on app startup"

---

## Performance Issues

### 1. Auth State Changes Cause Full App Re-render
**Severity:** MEDIUM
**Issue:**
- Auth context change triggers re-render of entire app
- Even if user just stayed logged in, full re-render

**Impact:**
- Unnecessary re-renders
- Slow navigation
- Battery drain

**Suggested Fix:**
Split auth context into separate concerns (authentication vs user data).

**Ticket:** Create task: "Split auth context to prevent full app re-renders"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Implement automatic token refresh mechanism | CRITICAL | Reliability |
| Add auth state synchronization with navigation | HIGH | Quality |
| Add offline auth fallback and cached session support | MEDIUM | Resilience |
| Add session validity check on app startup | MEDIUM | Quality |
| Split auth context to prevent full app re-renders | MEDIUM | Performance |
