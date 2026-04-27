/**
 * Bible API Edge Function
 *
 * Thin routing layer that delegates to adapters.
 * Handles auth, caching, and version routing.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { getAuthUser } from "../_shared/auth.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  unauthorized,
  badRequest,
  jsonResponse,
  serverError,
} from "../_shared/errors.ts";
import {
  checkAndIncrementBibleUsage,
  rateLimitResponse,
} from "../_shared/usage.ts";

// Adapters
import { esvAdapter } from "./adapters/esv.ts";
import { apiBibleAdapter } from "./adapters/apibible.ts";
import { BibleAdapter } from "./adapters/types.ts";

// Shared modules
import { normalizeReference } from "./normalize.ts";
import {
  getCachedVerse,
  cacheVerse,
  getCachedVerseRange,
  getCachedVerseRangeKeyed,
  getCachedChapter,
  cacheChapter,
} from "./cache.ts";
import { getExpectedVerseCount } from "./verse-counts.ts";

/**
 * Version → Adapter registry
 * Each version maps to its adapter.
 *
 * KJV is intentionally absent: the client serves KJV from a bundled
 * JSON (assets/bible/kjv-1769.json), so KJV requests never reach this
 * function. See docs/features/kjv-offline-bundle.md.
 */
const adapters: Record<string, BibleAdapter> = {
  ESV: esvAdapter,
  // API.Bible translations
  NLT: apiBibleAdapter,
  NIV: apiBibleAdapter,
  NKJV: apiBibleAdapter,
};

/**
 * Parse a normalized reference into components
 * "John 3" → { book: "John", chapter: 3 }
 * "John 3:16" → { book: "John", chapter: 3, verse: 16 }
 * "John 3:16-18" → { book: "John", chapter: 3, verse: 16, verseEnd: 18 }
 */
function parseReference(ref: string): {
  book: string;
  chapter: number;
  verse?: number;
  verseEnd?: number;
} | null {
  const match = ref.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return null;

  const [, book, chapter, verse, verseEnd] = match;
  return {
    book,
    chapter: parseInt(chapter, 10),
    verse: verse ? parseInt(verse, 10) : undefined,
    verseEnd: verseEnd ? parseInt(verseEnd, 10) : undefined,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only GET allowed
  if (req.method !== "GET") {
    return badRequest("Method not allowed");
  }

  // Authenticate user
  const user = await getAuthUser(req);
  if (!user) {
    return unauthorized();
  }

  // Parse query params
  const url = new URL(req.url);
  const rawRef = url.searchParams.get("ref");
  const version = url.searchParams.get("version") || "ESV";
  const isChapterRequest = url.searchParams.get("chapter") === "true";

  if (!rawRef) {
    return badRequest("Missing 'ref' parameter");
  }

  // Get adapter for requested version
  const adapter = adapters[version];
  if (!adapter) {
    return badRequest(
      `Unsupported version: ${version}. Supported: ${Object.keys(adapters).join(", ")}`
    );
  }

  // Normalize reference ONCE, use everywhere
  const ref = normalizeReference(rawRef);

  // Parse into components
  const parsed = parseReference(ref);
  if (!parsed) {
    return badRequest(`Invalid reference format: ${ref}`);
  }

  // Check usage limits
  const usage = await checkAndIncrementBibleUsage(user.id);
  if (!usage.allowed) {
    return rateLimitResponse(usage.used, usage.limit);
  }

  try {
    if (isChapterRequest) {
      // Get expected verse count for validation and cache check
      const expectedCount = getExpectedVerseCount(ref) || 0;

      // Check cache
      const cached = await getCachedChapter(
        parsed.book,
        parsed.chapter,
        version,
        expectedCount
      );
      if (cached) {
        console.log(`[BIBLE] DB cache hit: ${ref} (${version}) - ${Object.keys(cached).length} verses`);
        return jsonResponse({
          reference: ref,
          version,
          verses: cached,
          cached: true,
        });
      }

      // Fetch via adapter
      console.log(`[BIBLE] Fetching chapter from API: ${ref} (${version})`);
      const result = await adapter.fetchChapter(ref, version, expectedCount);

      // Cache result (verse-level)
      await cacheChapter(parsed.book, parsed.chapter, version, result.verses);
      console.log(`[BIBLE] Cached chapter: ${ref} (${version}) - ${Object.keys(result.verses).length} verses`);

      return jsonResponse({
        reference: ref,
        version,
        verses: result.verses,
        cached: false,
      });
    }

    // Single verse or verse range request
    if (parsed.verse) {
      const verseEnd = parsed.verseEnd || parsed.verse;

      // Check cache
      let cachedText: string | null = null;
      if (parsed.verseEnd) {
        cachedText = await getCachedVerseRange(
          parsed.book,
          parsed.chapter,
          parsed.verse,
          verseEnd,
          version
        );
      } else {
        cachedText = await getCachedVerse(
          parsed.book,
          parsed.chapter,
          parsed.verse,
          version
        );
      }

      if (cachedText) {
        // Also get keyed data for new clients
        const cachedVerses = parsed.verseEnd
          ? await getCachedVerseRangeKeyed(
              parsed.book,
              parsed.chapter,
              parsed.verse,
              verseEnd,
              version
            )
          : { [parsed.verse.toString()]: cachedText };
        console.log(`[BIBLE] DB cache hit: ${ref} (${version})`);
        return jsonResponse({
          reference: ref,
          version,
          text: cachedText,
          verses: cachedVerses || {},
          cached: true,
        });
      }

      // For ranges, fetch the chapter and extract individual verses
      // This allows us to cache each verse separately for proper range lookups
      if (parsed.verseEnd) {
        console.log(`[BIBLE] Fetching range from API: ${ref} (${version})`);
        const expectedCount = getExpectedVerseCount(`${parsed.book} ${parsed.chapter}`) || 0;
        const chapterResult = await adapter.fetchChapter(
          `${parsed.book} ${parsed.chapter}`,
          version,
          expectedCount
        );

        // Extract just the verses we need
        const rangeVerses: Record<string, string> = {};
        for (let v = parsed.verse; v <= verseEnd; v++) {
          const verseText = chapterResult.verses[v.toString()];
          if (verseText) {
            rangeVerses[v.toString()] = verseText;
          }
        }

        // Cache each verse individually (cacheChapter handles this)
        await cacheChapter(parsed.book, parsed.chapter, version, rangeVerses);
        console.log(`[BIBLE] Cached range: ${ref} (${version}) - ${Object.keys(rangeVerses).length} verses`);

        // Combine for response
        const combinedText = Object.values(rangeVerses).join(" ");
        return jsonResponse({
          reference: ref,
          version,
          text: combinedText,
          verses: rangeVerses,
          cached: false,
        });
      }

      // Single verse - fetch and cache normally
      console.log(`[BIBLE] Fetching single verse from API: ${ref} (${version})`);
      const result = await adapter.fetchVerse(ref, version);
      await cacheVerse(
        parsed.book,
        parsed.chapter,
        parsed.verse,
        version,
        result.text
      );
      console.log(`[BIBLE] Cached single verse: ${ref} (${version})`);

      return jsonResponse({
        reference: ref,
        version,
        text: result.text,
        verses: { [parsed.verse.toString()]: result.text },
        cached: false,
      });
    }

    // Chapter-only reference without ?chapter=true (treat as chapter request)
    const expectedCount = getExpectedVerseCount(ref) || 0;
    const cached = await getCachedChapter(
      parsed.book,
      parsed.chapter,
      version,
      expectedCount
    );
    if (cached) {
      return jsonResponse({
        reference: ref,
        version,
        verses: cached,
        cached: true,
      });
    }

    const result = await adapter.fetchChapter(ref, version, expectedCount);
    await cacheChapter(parsed.book, parsed.chapter, version, result.verses);

    return jsonResponse({
      reference: ref,
      version,
      verses: result.verses,
      cached: false,
    });
  } catch (error) {
    console.error(`Bible fetch error (${version}):`, error);
    return serverError("Failed to fetch verse");
  }
});
