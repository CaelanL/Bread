#!/usr/bin/env node

/**
 * KJV bundle cleanup
 *
 * Reads assets/bible/kjv-1769.json, strips two artifacts that exist in
 * the upstream public-domain KJV data, validates verse counts against
 * structure.json, and writes the cleaned file back in place.
 *
 * Artifacts being stripped:
 *
 *   1. Square brackets around italicized "supplied" words. In KJV print
 *      Bibles, italics mark words required by English grammar that are
 *      not literally present in the Hebrew/Greek source. The bundled
 *      JSON encodes these as `[bracket]` notation. We strip the brackets
 *      but KEEP the words — those words are part of how the verse reads,
 *      and removing them would break grammar and ruin scoring.
 *      Example: "the LORD [is] righteous" → "the LORD is righteous".
 *
 *   2. Leading "#" prefix on certain verses. These mark paragraph breaks
 *      in the source data. We don't render paragraphs, so they're noise.
 *      Example: "# And God said, Let there be a firmament..."
 *               → "And God said, Let there be a firmament..."
 *
 *   3. Book name normalization. The upstream bundle uses "Solomon's Song"
 *      while the rest of the codebase (structure.json, normalize.ts,
 *      verse-counts.ts, etc.) uses "Song of Solomon". We rewrite the
 *      keys to the canonical name so the bundle is interchangeable
 *      with every other source.
 *
 * Run with: node scripts/clean-kjv.js
 *
 * Re-run only if assets/bible/kjv-1769.json is replaced with a fresh
 * upstream pull. Idempotent — running on an already-cleaned file is
 * a no-op.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const KJV_PATH = path.join(root, "assets/bible/kjv-1769.json");
const STRUCTURE_PATH = path.join(root, "assets/bible/structure.json");

function cleanText(text) {
  return text
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/^#\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BOOK_NAME_FIXES = {
  "Solomon's Song": "Song of Solomon",
};

function normalizeKey(key) {
  for (const [from, to] of Object.entries(BOOK_NAME_FIXES)) {
    if (key.startsWith(from + " ")) {
      return to + key.slice(from.length);
    }
  }
  return key;
}

function main() {
  const raw = fs.readFileSync(KJV_PATH, "utf8");
  const data = JSON.parse(raw);
  const structure = JSON.parse(fs.readFileSync(STRUCTURE_PATH, "utf8"));

  const keys = Object.keys(data);
  console.log(`Loaded ${keys.length} verses from ${path.relative(root, KJV_PATH)}`);

  // Clean every verse
  const cleaned = {};
  let bracketsStripped = 0;
  let hashesStripped = 0;
  let keysRenamed = 0;
  let unchanged = 0;
  for (const k of keys) {
    const original = data[k];
    if (/\[/.test(original)) bracketsStripped++;
    if (original.startsWith("#")) hashesStripped++;
    const nextKey = normalizeKey(k);
    if (nextKey !== k) keysRenamed++;
    const nextText = cleanText(original);
    if (nextKey === k && nextText === original) unchanged++;
    cleaned[nextKey] = nextText;
  }

  console.log(`  Bracket strips: ${bracketsStripped}`);
  console.log(`  Hash-prefix strips: ${hashesStripped}`);
  console.log(`  Keys renamed (book name normalization): ${keysRenamed}`);
  console.log(`  Verses unchanged: ${unchanged}`);

  // Validate verse counts against structure.json
  console.log("\nValidating verse counts against structure.json...");
  const errors = [];
  for (const book of structure) {
    for (let chIdx = 0; chIdx < book.chapters.length; chIdx++) {
      const chapter = chIdx + 1;
      const expected = book.chapters[chIdx];
      let found = 0;
      for (let v = 1; v <= expected; v++) {
        const ref = `${book.book} ${chapter}:${v}`;
        if (cleaned[ref]) found++;
      }
      if (found !== expected) {
        errors.push(`${book.book} ${chapter}: expected ${expected}, found ${found}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\nVerse-count validation FAILED with ${errors.length} chapter(s):`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    if (errors.length > 20) console.error(`  ...and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log("  All chapters match expected counts ✓");

  // Sanity: confirm no artifacts remain in the cleaned data
  console.log("\nSanity check: confirming no residual artifacts...");
  let leftBrackets = 0;
  let leftHashes = 0;
  for (const k of Object.keys(cleaned)) {
    if (/\[/.test(cleaned[k])) leftBrackets++;
    if (cleaned[k].startsWith("#")) leftHashes++;
  }
  if (leftBrackets > 0 || leftHashes > 0) {
    console.error(`  FAIL: ${leftBrackets} verses still have brackets, ${leftHashes} still have leading #`);
    process.exit(1);
  }
  console.log("  No brackets or hash prefixes remain ✓");

  // Write back. Match the upstream's one-verse-per-line minified style
  // so the diff in PR is reviewable line-by-line.
  const orderedKeys = keys.map(normalizeKey);
  const lines = ["{"];
  for (let i = 0; i < orderedKeys.length; i++) {
    const k = orderedKeys[i];
    const comma = i < orderedKeys.length - 1 ? "," : "";
    lines.push(`${JSON.stringify(k)}:${JSON.stringify(cleaned[k])}${comma}`);
  }
  lines.push("}");
  // Atomic write: temp file + rename, so a Ctrl-C mid-write can't
  // corrupt the bundle on disk.
  const tmpPath = KJV_PATH + ".tmp";
  fs.writeFileSync(tmpPath, lines.join("\n"));
  fs.renameSync(tmpPath, KJV_PATH);
  console.log(`\nWrote cleaned bundle to ${path.relative(root, KJV_PATH)}`);
}

main();
