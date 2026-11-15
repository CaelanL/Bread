/**
 * Crossway ESV text → verse map. Pure: no Deno globals and no imports, so
 * lib/__tests__/bible-adapters.test.ts can test it under Node.
 *
 * The ESV adapter asks for verse numbers on every path, single verse and
 * chapter, and parses both with `parseEsvPassage`:
 *   "A Psalm of David…\n\n[1] O LORD, how many…\n[2] …"
 * Text before the first "[n]" is a psalm title or stanza name and is dropped.
 */

// Lines Crossway prints on their own between verses: the Psalm 119 stanza
// names and the Song of Solomon speaker labels.
const LABELS = new Set([
  "Aleph", "Beth", "Gimel", "Daleth", "He", "Waw", "Zayin", "Heth", "Teth", "Yodh", "Kaph", "Lamedh",
  "Mem", "Nun", "Samekh", "Ayin", "Pe", "Tsadhe", "Qoph", "Resh", "Sin and Shin", "Taw",
  "She", "Others",
]);

export function parseEsvPassage(text: string): Record<string, string> {
  const cleaned = text
    .split(/\n{2,}/)
    .filter((paragraph) => !LABELS.has(paragraph.trim()))
    .join("\n\n")
    // Manuscript notes ("[Some manuscripts add…]"), and the double brackets
    // around passages like Mark 16:9-20 ("[[9] …]]").
    .replace(/\[[A-Za-z][^[\]]*\]/g, " ")
    .replace(/\[\[(?=\[\d+\])/g, "")
    .replace(/\]\]/g, "");

  const verses: Record<string, string> = {};
  const markers = [...cleaned.matchAll(/\[(\d+)\]/g)];
  markers.forEach((marker, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].index : cleaned.length;
    const verseText = cleaned.slice(marker.index + marker[0].length, end).replace(/\s+/g, " ").trim();
    if (verseText) verses[marker[1]] = verseText;
  });
  return verses;
}

// Crossway reads "Jude 1" as Jude 1:1, so a one-chapter book asks for its
// verses by number.
export function esvChapterQuery(ref: string, chaptersInBook: number, versesInChapter: number): string {
  return chaptersInBook === 1 && versesInChapter > 0 ? `${ref}:1-${versesInChapter}` : ref;
}
