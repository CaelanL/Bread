/**
 * Bible API Edge Function
 *
 * Thin routing layer that delegates to adapters.
 * Handles auth, caching, and version routing. Only a server cache miss counts against the daily
 * limit (docs/architecture/bible-api-and-caching.md).
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyJwt } from "../_shared/auth.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  unauthorized,
  badRequest,
  jsonResponse,
  serverError,
} from "../_shared/errors.ts";
import { rateLimitResponse } from "../_shared/usage.ts";
import { countBibleFetch, readBibleUsage, type BibleUsage } from "./usage.ts";

// Adapters
import { esvAdapter } from "./adapters/esv.ts";
import { apiBibleAdapter } from "./adapters/apibible.ts";
import { BibleAdapter } from "./adapters/types.ts";

// Shared modules
import { normalizeReference } from "./normalize.ts";
import {
  getCachedVerses,
  cacheVerse,
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

// Licensed text must never land in an HTTP cache on the device or in between.
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// Writes the cache after the response is out; awaited where the runtime can't wait for it.
async function afterResponse(work: Promise<void>): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const logged = work.catch((e) => console.error("[BIBLE] Cache write failed:", e));
  if (runtime?.waitUntil) runtime.waitUntil(logged);
  else await logged;
}

serve(async (req) => noStore(await handle(req)));

async function handle(req: Request): Promise<Response> {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only GET allowed
  if (req.method !== "GET") {
    return badRequest("Method not allowed");
  }

  // Authenticate user (a local signature check, no call to Auth)
  const user = await verifyJwt(req);
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

  // Read the usage alongside the cache; only a miss needs it.
  const usageRead = readBibleUsage(user.id);
  usageRead.catch(() => {});

  // A miss over the limit answers 429; otherwise it counts one, alongside the external fetch.
  async function fetchCounted<T>(fetch: () => Promise<T>): Promise<T | Response> {
    const usage: BibleUsage = await usageRead;
    if (usage.used >= usage.limit) {
      return rateLimitResponse(usage.used, usage.limit);
    }
    const [result] = await Promise.all([fetch(), countBibleFetch(usage)]);
    return result;
  }

  try {
    // A chapter, with ?chapter=true or as a chapter-only reference
    if (isChapterRequest || !parsed.verse) {
      // Get expected verse count for validation and cache check
      const expectedCount = getExpectedVerseCount(ref) || 0;

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

      console.log(`[BIBLE] Fetching chapter from API: ${ref} (${version})`);
      const result = await fetchCounted(() => adapter.fetchChapter(ref, version, expectedCount));
      if (result instanceof Response) return result;

      // Cache result (verse-level)
      await afterResponse(cacheChapter(parsed.book, parsed.chapter, version, result.verses));

      return jsonResponse({
        reference: ref,
        version,
        verses: result.verses,
        cached: false,
      });
    }

    // Single verse or verse range request
    const verseStart = parsed.verse;
    const verseEnd = parsed.verseEnd || verseStart;

    const cachedVerses = await getCachedVerses(
      parsed.book,
      parsed.chapter,
      verseStart,
      verseEnd,
      version
    );
    if (cachedVerses) {
      console.log(`[BIBLE] DB cache hit: ${ref} (${version})`);
      return jsonResponse({
        reference: ref,
        version,
        text: Object.values(cachedVerses).join(" "),
        verses: cachedVerses,
        cached: true,
      });
    }

    // For ranges, fetch the chapter and extract individual verses
    // This allows us to cache each verse separately for proper range lookups
    if (parsed.verseEnd) {
      console.log(`[BIBLE] Fetching range from API: ${ref} (${version})`);
      const expectedCount = getExpectedVerseCount(`${parsed.book} ${parsed.chapter}`) || 0;
      const chapterResult = await fetchCounted(() =>
        adapter.fetchChapter(`${parsed.book} ${parsed.chapter}`, version, expectedCount)
      );
      if (chapterResult instanceof Response) return chapterResult;

      // Extract just the verses we need
      const rangeVerses: Record<string, string> = {};
      for (let v = verseStart; v <= verseEnd; v++) {
        const verseText = chapterResult.verses[v.toString()];
        if (verseText) {
          rangeVerses[v.toString()] = verseText;
        }
      }

      // Cache each verse individually (cacheChapter handles this)
      await afterResponse(cacheChapter(parsed.book, parsed.chapter, version, rangeVerses));

      return jsonResponse({
        reference: ref,
        version,
        text: Object.values(rangeVerses).join(" "),
        verses: rangeVerses,
        cached: false,
      });
    }

    // Single verse - fetch and cache normally
    console.log(`[BIBLE] Fetching single verse from API: ${ref} (${version})`);
    const result = await fetchCounted(() => adapter.fetchVerse(ref, version));
    if (result instanceof Response) return result;
    await afterResponse(cacheVerse(parsed.book, parsed.chapter, verseStart, version, result.text));

    return jsonResponse({
      reference: ref,
      version,
      text: result.text,
      verses: { [verseStart.toString()]: result.text },
      cached: false,
    });
  } catch (error) {
    console.error(`Bible fetch error (${version}):`, error);
    return serverError("Failed to fetch verse");
  }
}
