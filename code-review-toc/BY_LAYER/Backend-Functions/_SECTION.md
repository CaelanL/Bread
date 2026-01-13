# Backend-Functions Layer

## Purpose

Edge functions running on Supabase. Server-side business logic, authentication, data processing, and API endpoints.

## Responsibilities

- Handle HTTP requests from client
- Authentication and authorization
- Business logic execution
- Data validation and transformation
- Database queries and mutations
- Rate limiting and usage tracking
- CORS handling
- Error handling and responses

## Source Files to Review

### Bible Function
- `supabase/functions/bible/index.ts` - Bible API router
- `supabase/functions/bible/adapters/esv.ts` - ESV adapter
- `supabase/functions/bible/adapters/nlt.ts` - NLT adapter
- `supabase/functions/bible/adapters/kjv.ts` - KJV adapter
- `supabase/functions/bible/adapters/types.ts` - Adapter interface
- `supabase/functions/bible/cache.ts` - Bible caching
- `supabase/functions/bible/normalize.ts` - Text normalization
- `supabase/functions/bible/verse-counts.ts` - Verse metadata

### Recording Function
- `supabase/functions/process-recording/index.ts` - Recording processing

### Shared Utilities
- `supabase/functions/_shared/auth.ts` - Auth utilities
- `supabase/functions/_shared/cors.ts` - CORS handling
- `supabase/functions/_shared/errors.ts` - Error utilities
- `supabase/functions/_shared/usage.ts` - Rate limiting/usage tracking
- `supabase/functions/_shared/concurrency.ts` - Concurrency utilities

## Review Focus

### Scale Issues
- Are queries optimized? (no N+1 problems?)
- Are database indexes used effectively?
- Does the function handle concurrent requests?
- Is rate limiting effective at scale?
- Are heavy operations (recording processing) async?
- Can functions be invoked at scale without timeouts?

### Code Quality
- Is authentication properly enforced?
- Are inputs validated before processing?
- Are database queries safe (SQL injection prevention)?
- Is error handling comprehensive?
- Are errors properly typed and logged?
- Is code duplicated across functions?
- Are there lazy implementations or TODOs?

### Future-Proofing
- Can we easily add new Bible versions?
- Can we add new endpoints without refactoring?
- Can we version endpoints for backwards compatibility?
- Can we add request signing or additional security?
- Can we audit API usage?

### Known Concerns
- Adapter pattern consistency
- Caching invalidation strategy
- Recording processing reliability
- Rate limiting effectiveness
- Error logging and monitoring

## Related Sections

- `BY_LAYER/API-Layer/` - Client calls to these functions
- `BY_LAYER/Database-Schema/` - Database being accessed
- `BY_DOMAIN/Bible-Data/` - Bible function details
- `BY_ARCHITECTURE/Error-Handling/` - Error strategy

## Next Steps

Create a `FINDINGS.md` file in your output directory.
