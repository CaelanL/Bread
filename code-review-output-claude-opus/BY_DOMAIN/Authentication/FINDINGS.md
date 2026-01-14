[STATUS: review_done_needs_followup]

# BY_DOMAIN/Authentication Code Review

## Summary
Authentication uses Supabase Auth with a well-designed context provider. The backend implements local JWT verification using ES256 with a hardcoded public key, which is efficient but requires key rotation procedures. The auth flow supports email/password, Google OAuth, and anonymous users. Overall solid implementation with a few concerns around key management and error handling.

---

## Critical Issues

### 1. Hardcoded JWT Public Key Requires Manual Rotation (HIGH)
**File:** `supabase/functions/_shared/auth.ts:18-25`
**Issue:** The public key is hardcoded in the edge function:

```typescript
// Last updated: 2025-12-22, Key ID: 55eb77c6-b625-411d-9a4f-d58ec8eb91a9
const PUBLIC_KEY_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "87xM-IKCdbYdw01eWMOCVfcm0pxV3k_v-fok-VU7lEE",
  y: "yYGkYaARJrfqFGLYCJmh_HVqrSnCwlRA5NFfOFn6phk",
};
```

**Impact:**
- If Supabase rotates JWT signing keys, ALL API calls will fail until code is updated and deployed
- No fallback or automatic key refresh
- Single point of failure

**Suggested Fix:**
1. Fetch keys from JWKS endpoint with caching
2. Store key in environment variable for easier rotation
3. Add fallback to remote verification if local fails

### 2. No Rate Limiting on Sign In/Sign Up (MEDIUM-HIGH)
**Files:** `lib/auth/context.tsx:44-66`
**Issue:** No client-side rate limiting on auth attempts:

```typescript
const signIn = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // No delay, no attempt counting
};
```

**Impact:** Allows brute force attacks (though Supabase server-side may limit this).

**Suggested Fix:** Add exponential backoff or lockout after N failed attempts.

### 3. No Token Refresh Error Recovery (MEDIUM-HIGH)
**File:** `lib/api/client.ts:18-25`
**Issue:** Supabase client has `autoRefreshToken: true` but no error handling for refresh failures:

```typescript
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    // What if refresh fails?
  },
});
```

**Impact:** If token refresh fails (network issues, server down), user gets logged out without notification.

**Suggested Fix:** Add `onAuthStateChange` listener for `TOKEN_REFRESHED` and `SIGNED_OUT` events with appropriate error handling.

---

## Code Quality Issues

### 4. Silent Anonymous Auth Fallback (MEDIUM)
**File:** `lib/api/client.ts:31-44`
**Issue:** `ensureAuth()` falls back to anonymous auth without user awareness:

```typescript
export async function ensureAuth(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    // User doesn't know they're anonymous
  }
}
```

**Impact:** Users may unknowingly be in anonymous mode, losing data if they don't sign up.

### 5. Password Validation Only Client-Side (MEDIUM)
**File:** `app/(auth)/sign-up.tsx:53-56`
**Issue:** Only checking minimum length on client:

```typescript
if (password.length < 6) {
  Alert.alert('Error', 'Password must be at least 6 characters');
  return;
}
```

Missing: uppercase, number, special character requirements. Should match Supabase server policy.

### 6. Google OAuth Redirect URI Hardcoded (LOW)
**File:** `lib/auth/context.tsx:69-75`
**Issue:** Redirect URI uses scheme directly:

```typescript
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'biblemem://',
  },
});
```

**Impact:** Different URIs needed for different environments (dev, staging, prod).

### 7. Unused `isDark` Variable (LOW)
**File:** `app/(auth)/sign-up.tsx:21`
**Issue:** `isDark` is declared but never used:
```typescript
const isDark = colorScheme === 'dark';
```

---

## Future-Proofing Issues

### 8. No MFA Support Architecture (MEDIUM)
**File:** `lib/auth/context.tsx`
**Issue:** Auth context doesn't have provisions for:
- MFA enrollment flow
- MFA challenge/verify
- Recovery codes

**Impact:** Adding MFA later requires significant refactoring.

### 9. No Device Session Management (MEDIUM)
**File:** `lib/auth/context.tsx`
**Issue:** Can't list/revoke sessions per device. `signOut()` only signs out current device:

```typescript
const signOut = async (): Promise<void> => {
  await supabase.auth.signOut();
  // Only this device
};
```

**Impact:** No "sign out all devices" security feature.

### 10. No Account Deletion Flow (LOW)
**File:** `lib/auth/context.tsx`
**Issue:** No method to delete user account. GDPR/privacy requirement.

---

## Scale Issues

### 11. Auth State Listener Not Debounced (LOW)
**File:** `lib/auth/context.tsx:33-39`
**Issue:** Every auth state change triggers re-render:

```typescript
supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
  setUser(session?.user ?? null);
  setIsLoading(false);
});
```

At scale with rapid token refreshes, could cause unnecessary renders.

### 12. Duplicate Auth Methods (getAuthUser vs verifyJwt) (LOW)
**File:** `supabase/functions/_shared/auth.ts`
**Issue:** Two ways to get user:
- `verifyJwt()` - local verification (fast, ~1ms)
- `getAuthUser()` - remote verification (slow, ~100ms)

No clear guidance on when to use which.

---

## Security Considerations

### 13. Service Role Key in Edge Functions (INFO)
**File:** `supabase/functions/_shared/auth.ts:140-144`
**Issue:** Service role key used for admin client:

```typescript
export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
```

This is correct usage but ensure key is never exposed in logs or error messages.

### 14. No Suspicious Login Detection (MEDIUM)
**Issue:** No tracking of:
- Login from new device/location
- Multiple failed attempts
- Unusual timing patterns

### 15. Email Not Validated Format (LOW)
**File:** `app/(auth)/sign-in.tsx:38-41`
**Issue:** Only checks for non-empty email:

```typescript
if (!email.trim() || !password.trim()) {
  Alert.alert('Error', 'Please enter email and password');
  return;
}
```

No regex validation for email format.

---

## Positive Observations

1. **Well-typed Auth Context**: `AuthContextType` interface is comprehensive
2. **Proper ES256 JWT Verification**: Using Web Crypto API correctly
3. **Session Persistence**: `persistSession: true` with AsyncStorage works well
4. **Google OAuth Ready**: OAuth flow already implemented
5. **Anonymous Auth Support**: Good for try-before-signup UX

---

## Tickets to Create

- [ ] AUTH-001: Implement JWKS endpoint caching for key rotation (HIGH)
- [ ] AUTH-002: Add rate limiting on auth attempts (MEDIUM-HIGH)
- [ ] AUTH-003: Handle token refresh failures gracefully (MEDIUM-HIGH)
- [ ] AUTH-004: Add client-side email format validation (LOW)
- [ ] AUTH-005: Add "sign out all devices" feature (MEDIUM)
- [ ] AUTH-006: Implement account deletion for GDPR (MEDIUM)
- [ ] AUTH-007: Prepare auth context for MFA flow (MEDIUM)
- [ ] AUTH-008: Remove unused `isDark` variable (LOW)
- [ ] AUTH-009: Environment-specific OAuth redirect URIs (LOW)

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `lib/api/client.ts` | 67 | ✅ Reviewed |
| `lib/auth/context.tsx` | 119 | ✅ Reviewed |
| `lib/auth/index.ts` | 2 | ✅ Reviewed |
| `app/(auth)/sign-in.tsx` | 246 | ✅ Reviewed |
| `app/(auth)/sign-up.tsx` | 290 | ✅ Reviewed |
| `supabase/functions/_shared/auth.ts` | 215 | ✅ Reviewed |

---

## Next Section
Continue with `BY_LAYER/State-Management/`
