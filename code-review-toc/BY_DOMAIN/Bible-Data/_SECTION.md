# Bible-Data Domain

## Purpose

Provides access to Bible text in multiple versions (ESV, NLT, KJV), handles verse fetching, normalization, caching, and ensures consistent Bible data across the app.

## Key Responsibilities

- Fetch verses by reference (book, chapter, verse)
- Fetch entire chapters
- Support multiple Bible versions
- Normalize Bible text (different versions may have different formatting)
- Cache Bible data to reduce API calls
- Handle version-specific adapters
- Manage expected verse counts per chapter

## Source Files to Review

### Frontend API
- `lib/api/bible.ts` - Bible API client functions
- `lib/bible/index.ts` - Bible utilities

### Backend
- `supabase/functions/bible/index.ts` - Bible edge function (main router)
- `supabase/functions/bible/adapters/esv.ts` - ESV Bible adapter
- `supabase/functions/bible/adapters/nlt.ts` - NLT Bible adapter
- `supabase/functions/bible/adapters/kjv.ts` - KJV Bible adapter
- `supabase/functions/bible/adapters/types.ts` - Adapter interface
- `supabase/functions/bible/cache.ts` - Bible caching logic
- `supabase/functions/bible/normalize.ts` - Text normalization
- `supabase/functions/bible/verse-counts.ts` - Expected verse counts

### Data
- `assets/bible/kjv-1769.json` - KJV bible data (local)
- `assets/bible/structure.json` - Bible structure data
- `lib/bible/books.ts` - Book definitions
- `lib/bible/types.ts` - Bible type definitions

## Review Focus

### Scale Issues
- How many Bible requests per user per day? API quota sustainable?
- Is caching effective? (cache hit rate?)
- Are we fetching full chapters when we only need one verse?
- Does the adapter pattern scale with new versions?
- How efficient is the normalization process?
- Can we handle peak load (millions of verse requests daily)?

### Code Quality
- Are Bible references properly validated?
- Do adapters handle edge cases (missing verses, different structures)?
- Is error handling comprehensive (invalid book, chapter, verse)?
- Are verse counts accurate? (no off-by-one errors?)
- Is caching logic correct (invalidation, TTL)?
- Are there any lazy implementations or incomplete adapters?

### Future-Proofing
- Can we easily add new Bible versions?
- Can we support different Bible versions for different users simultaneously?
- Can we add Bible commentary or cross-references?
- Can we add highlighting or annotations in Bible text?
- Can we support audio Bible versions?
- Can we handle Bible version updates/corrections?

### Known Concerns
- Adapter implementation consistency
- Caching strategy and cache invalidation
- Verse count accuracy
- Error handling for missing/invalid references
- Performance of normalization

## Related Sections

- `BY_LAYER/API-Layer/` - Bible API implementation
- `BY_LAYER/Backend-Functions/` - Bible edge functions
- `BY_LAYER/Storage/` - Bible data persistence
- `BY_ARCHITECTURE/Caching-Strategy/` - Bible caching details
- `BY_ARCHITECTURE/Performance/` - Bible fetch performance

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Bible-Data/FINDINGS.md` and document your review.
