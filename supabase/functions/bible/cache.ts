/**
 * Bible Cache (Verse-Level with LRU Eviction)
 *
 * Stores individual verses for precise counting and overlap handling.
 * Max 500 verses per version (ESV/NLT licensing requirement).
 */

import { getAdminClient } from "../_shared/auth.ts";

const MAX_VERSES_PER_VERSION = 500;

// Which revision of the adapters' parsing wrote a row. Reads take only this
// revision, so a row from older parsing is a miss and the upsert overwrites
// it. Bump it whenever an adapter's output changes.
const TEXT_REV = 1;

/**
 * Get cached chapter (all verses for a book+chapter)
 * Returns null if ANY verse is missing
 */
export async function getCachedChapter(
  book: string,
  chapter: number,
  version: string,
  expectedVerseCount: number
): Promise<Record<string, string> | null> {
  const admin = getAdminClient();

  // If expectedCount is 0 (unknown), we can't validate completeness
  if (expectedVerseCount === 0) {
    console.warn(
      `Unknown verse count for ${book} ${chapter}, skipping cache (cannot validate completeness)`
    );
    return null;
  }

  const { data, error } = await admin
    .from("verse_cache")
    .select("verse, text")
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("version", version)
    .eq("text_rev", TEXT_REV)
    .order("verse", { ascending: true });

  if (error || !data) {
    console.error("Cache lookup error:", error);
    return null;
  }

  // Check if we have all verses
  if (data.length < expectedVerseCount) {
    return null; // Cache miss - don't have complete chapter
  }

  // Update last_used_at for LRU (fire and forget)
  admin
    .from("verse_cache")
    .update({ last_used_at: new Date().toISOString() })
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("version", version)
    .then(() => {});

  // Convert to Record<string, string>
  const verses: Record<string, string> = {};
  for (const row of data) {
    verses[row.verse.toString()] = row.text;
  }

  return verses;
}

/**
 * Cache a chapter (insert/update all verses)
 * Handles LRU eviction if over limit
 */
export async function cacheChapter(
  book: string,
  chapter: number,
  version: string,
  verses: Record<string, string>
): Promise<void> {
  const admin = getAdminClient();
  const verseCount = Object.keys(verses).length;

  // This version's count, and how many of these verses are already cached
  const verseNums = Object.keys(verses).map((v) => parseInt(v, 10));
  const [{ count }, { count: existingCount }] = await Promise.all([
    admin
      .from("verse_cache")
      .select("*", { count: "exact", head: true })
      .eq("version", version),
    admin
      .from("verse_cache")
      .select("*", { count: "exact", head: true })
      .eq("book", book)
      .eq("chapter", chapter)
      .eq("version", version)
      .in("verse", verseNums),
  ]);

  const currentCount = count || 0;

  const newVerses = verseCount - (existingCount || 0);
  const projectedCount = currentCount + newVerses;

  // Evict if needed
  if (projectedCount > MAX_VERSES_PER_VERSION) {
    const toEvict = projectedCount - MAX_VERSES_PER_VERSION;
    await evictOldestVerses(version, toEvict, book, chapter);
  }

  // Upsert verses
  const rows = Object.entries(verses).map(([verseNum, text]) => ({
    book,
    chapter,
    verse: parseInt(verseNum, 10),
    version,
    text,
    text_rev: TEXT_REV,
    last_used_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("verse_cache").upsert(rows, {
    onConflict: "book,chapter,verse,version",
  });

  if (error) {
    console.error("Cache upsert error:", error);
  }
}

/**
 * Evict oldest verses (by last_used_at) to make room
 * Excludes verses from the current book+chapter being cached
 */
async function evictOldestVerses(
  version: string,
  count: number,
  excludeBook?: string,
  excludeChapter?: number
): Promise<void> {
  const admin = getAdminClient();

  // Find oldest verses to evict (excluding current chapter)
  let query = admin
    .from("verse_cache")
    .select("id")
    .eq("version", version)
    .order("last_used_at", { ascending: true })
    .limit(count);

  // Exclude current chapter from eviction (only exclude where BOTH book AND chapter match)
  if (excludeBook && excludeChapter !== undefined) {
    query = query.not("and", `(book.eq.${excludeBook},chapter.eq.${excludeChapter})`);
  }

  const { data: toEvict } = await query;

  if (toEvict && toEvict.length > 0) {
    const ids = toEvict.map((row) => row.id);
    const { error } = await admin.from("verse_cache").delete().in("id", ids);

    if (error) {
      console.error("Eviction error:", error);
    } else {
      console.log(`Evicted ${ids.length} verses from ${version} cache`);
    }
  }
}

/**
 * Get cached verses, keyed by verse number (one query for a verse or a range)
 * Returns null if ANY verse in range is missing
 */
export async function getCachedVerses(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  version: string
): Promise<Record<string, string> | null> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("verse_cache")
    .select("verse, text")
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("version", version)
    .eq("text_rev", TEXT_REV)
    .gte("verse", verseStart)
    .lte("verse", verseEnd)
    .order("verse", { ascending: true });

  if (error || !data) {
    return null;
  }

  // Check we have all verses in range
  const expectedCount = verseEnd - verseStart + 1;
  if (data.length < expectedCount) {
    return null;
  }

  // Update last_used_at for LRU (fire and forget)
  admin
    .from("verse_cache")
    .update({ last_used_at: new Date().toISOString() })
    .eq("book", book)
    .eq("chapter", chapter)
    .eq("version", version)
    .gte("verse", verseStart)
    .lte("verse", verseEnd)
    .then(() => {});

  const verses: Record<string, string> = {};
  for (const row of data) {
    verses[row.verse.toString()] = row.text;
  }
  return verses;
}

/**
 * Cache a single verse
 */
export async function cacheVerse(
  book: string,
  chapter: number,
  verse: number,
  version: string,
  text: string
): Promise<void> {
  const admin = getAdminClient();

  // Whether it already exists, and this version's count
  const [{ count: existingCount }, { count }] = await Promise.all([
    admin
      .from("verse_cache")
      .select("*", { count: "exact", head: true })
      .eq("book", book)
      .eq("chapter", chapter)
      .eq("verse", verse)
      .eq("version", version),
    admin
      .from("verse_cache")
      .select("*", { count: "exact", head: true })
      .eq("version", version),
  ]);

  // If new verse, check limit
  if (!existingCount && (count || 0) >= MAX_VERSES_PER_VERSION) {
    await evictOldestVerses(version, 1);
  }

  // Upsert
  const { error } = await admin.from("verse_cache").upsert(
    {
      book,
      chapter,
      verse,
      version,
      text,
      text_rev: TEXT_REV,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "book,chapter,verse,version" }
  );

  if (error) {
    console.error("Cache verse error:", error);
  }
}

/**
 * Get cache stats for debugging
 */
export async function getCacheStats(): Promise<Record<string, number>> {
  const admin = getAdminClient();

  const { data } = await admin.from("verse_cache_stats").select("*");

  const stats: Record<string, number> = {};
  for (const row of data || []) {
    stats[row.version] = row.verse_count;
  }

  return stats;
}
