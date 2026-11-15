/**
 * API.Bible HTML → verse map. Pure: no Deno globals and no imports, so
 * lib/__tests__/bible-adapters.test.ts can test it under Node.
 *
 * The API.Bible adapter asks for HTML with verse numbers on both paths
 * (chapters and single-verse passages) and parses both with
 * `parseApiBibleHtml`. Verses start at
 *   <span data-number="16" … class="v">16</span>
 * and NLT merges some rows ("20-21"), keyed here under the first number so a
 * range never asks for the same words twice. Text before the first verse
 * ("Psalm 23", a stanza letter) is dropped.
 */

// Psalm 119 stanza headings ("א Aleph"), dropped when a block holds only one.
// A Hebrew letter and one word is a heading in any spelling ("ס Samek").
const STANZA =
  /^[א-ת]\s*[A-Za-z]*$|^[א-ת]?\s*(Aleph|Alef|Beth|Bet|Gimel|Daleth|Dalet|He|Waw|Vav|Zayin|Heth|Het|Teth|Tet|Yodh|Yod|Kaph|Kaf|Lamedh|Lamed|Mem|Nun|Samekh|Ayin|Pe|Tsadhe|Tsadi|Qoph|Qof|Resh|Sin|Shin|Sin and Shin|Taw|Tav)?\s*$/i;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”",
  ldquo: "“", mdash: "—", ndash: "–", hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[body.toLowerCase()] ?? entity;
  });
}

// Every tag becomes a space, so a poetry line, paragraph or quote break never
// glues two words ("shepherd;I"); the space that leaves before closing
// punctuation goes again. Manuscript notes ("[The earliest manuscripts…]")
// are dropped.
export function cleanApiBibleText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\[\s*[A-Za-z][^[\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?’”)\]])/g, "$1")
    .trim();
}

export function parseApiBibleHtml(html: string): Record<string, string> {
  const withoutStanzas = html.replace(
    /<(p|div|h\d)\b[^>]*>((?:(?!<\/?\1\b)[\s\S])*?)<\/\1>/gi,
    (block, _tag, inner: string) =>
      !/data-number=/.test(inner) && cleanApiBibleText(inner) && STANZA.test(cleanApiBibleText(inner)) ? " " : block,
  );

  const verses: Record<string, string> = {};
  const add = (verse: string | undefined, html: string) => {
    const text = cleanApiBibleText(html);
    if (verse && text) verses[verse] = verses[verse] ? `${verses[verse]} ${text}` : text;
  };
  // NLT's census tables open a later verse's span before that verse's marker
  // (Numbers 1): text goes to the verse its span names, so both paths agree.
  const byVerseSpan = (html: string, verse?: string) => {
    const spans = [...html.matchAll(/<span\b[^>]*\bdata-verse-id="[^".]+\.\d+\.(\d+)/g)]
      .filter((span, i, all) => span[1] !== (i ? all[i - 1][1] : verse));
    add(verse, html.slice(0, spans[0]?.index ?? html.length));
    spans.forEach((span, i) => add(span[1], html.slice(span.index, spans[i + 1]?.index ?? html.length)));
  };
  const markers = [...withoutStanzas.matchAll(/<span\b[^>]*\bdata-number="(\d+)(?:-\d+)?"[^>]*>[^<]*<\/span>/g)];
  byVerseSpan(withoutStanzas.slice(0, markers[0]?.index ?? 0));
  markers.forEach((marker, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].index : withoutStanzas.length;
    // NLT prints a dash rule after a verse, then a manuscript note or an
    // alternate ending (Mark 16:8): none of it is the verse.
    byVerseSpan(withoutStanzas.slice(marker.index + marker[0].length, end).split(/-{4,}/)[0], marker[1]);
  });
  return verses;
}

// One verse from a passage. NLT merges some rows ("20-21"), so a verse inside a merged row gets
// that row's text: it is the translation's text for both numbers. `merged` marks the second
// number's answer, which must not be cached as that verse, or a range would say the row twice.
export function parseApiBibleVerse(html: string, verse: string): { text: string; merged: boolean } | undefined {
  const verses = parseApiBibleHtml(html);
  if (verses[verse]) return { text: verses[verse], merged: false };
  for (const [, first, last] of html.matchAll(/data-number="(\d+)-(\d+)"/g)) {
    if (Number(first) < Number(verse) && Number(verse) <= Number(last) && verses[first]) return { text: verses[first], merged: true };
  }
  return undefined;
}
