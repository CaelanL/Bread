# Auth-Flow Architecture

## Purpose

End-to-end authentication architecture: how users log in, how sessions are maintained, and how auth state flows through the app.

## Key Questions

- How do tokens flow from server to client?
- How are tokens refreshed?
- How is auth state persisted across app restarts?
- What happens to the app if auth service is down?
- How quickly does auth state propagate to all screens?

## Source Files Involved

- `lib/auth/context.tsx` - Auth context and providers
- `lib/auth/index.ts` - Auth utilities
- `app/_layout.tsx` - Root layout (auth checks)
- `lib/store/index.ts` - Auth state in store
- `lib/api/client.ts` - Supabase client (token management)
- `supabase/functions/_shared/auth.ts` - Server-side auth

## Review Focus

### Architecture Issues
- Is token storage secure?
- Are there race conditions on login/logout?
- Does auth state propagate correctly to all parts of app?
- Is there proper fallback if auth service is down?
- Can tokens be hijacked? (HTTPS, secure storage)

### Scale Issues
- Can token refresh handle 100k+ concurrent users?
- Are auth checks optimized (not blocking app)?
- Does auth state management scale to app complexity?

### Future-Proofing
- Can we add OAuth/SSO without refactoring?
- Can we add multi-factor authentication?
- Can we support multi-device sessions?

## Related Sections

- `BY_DOMAIN/Authentication/` - Auth feature details
- `BY_LAYER/API-Layer/` - Token management
- `BY_ARCHITECTURE/Error-Handling/` - Auth error recovery

## Next Steps

Create a `FINDINGS.md` file in your output directory.
