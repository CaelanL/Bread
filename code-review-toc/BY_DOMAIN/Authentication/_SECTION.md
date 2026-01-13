# Authentication Domain

## Purpose

Handles user identity, login/logout flows, password recovery, session management, and authentication tokens. This is the gatekeeper for all other features.

## Key Responsibilities

- User registration and account creation
- Sign-in with email/password
- Password recovery and reset
- Session token management (access/refresh tokens)
- Auth state persistence across app restarts
- Logout and session termination
- Auth error handling and messaging

## Source Files to Review

### Frontend
- `app/(auth)/sign-in.tsx` - Sign-in screen UI and logic
- `app/(auth)/sign-up.tsx` - Registration screen and user creation flow
- `app/(auth)/forgot-password.tsx` - Password recovery flow
- `app/(auth)/_layout.tsx` - Auth route layout
- `lib/auth/context.tsx` - Auth context provider, token state
- `lib/auth/index.ts` - Auth utility functions

### Backend
- `supabase/functions/_shared/auth.ts` - Shared auth utilities for edge functions
- `supabase/migrations/` - Check auth-related migrations

## Review Focus

### Scale Issues
- How are sessions managed at scale (10k+ concurrent users)?
- Token refresh strategy - will this overwhelm the auth service?
- Is token storage secure and performant?
- Can we handle multiple sessions per user?

### Code Quality
- Are tokens properly typed (no `any` types)?
- Are auth errors caught and handled gracefully?
- Is token refresh logic bulletproof or racy?
- Are passwords hashed and secured properly? (likely Supabase handles this, but verify)
- Are there race conditions on login/logout?

### Future-Proofing
- Can we easily add OAuth/social login without refactoring?
- Can we add multi-factor authentication?
- Can we handle device-specific sessions?
- Is the token structure versionable if we change it?

### Known Concerns
- Type safety of auth tokens
- Potential race conditions on logout
- Token refresh timing and edge cases
- Error handling when auth service is down

## Related Sections

- `BY_LAYER/Frontend-Screens/` - Auth screens implementation
- `BY_ARCHITECTURE/Auth-Flow/` - Full authentication flow architecture
- `BY_ARCHITECTURE/Type-Safety/` - Auth token typing

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Authentication/FINDINGS.md` and document your review.
