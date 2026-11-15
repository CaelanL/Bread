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
const STANZA =
  /^[א-ת]?\s*(Aleph|Alef|Beth|Bet|Gimel|Daleth|Dalet|He|Waw|Vav|Zayin|Heth|Het|Teth|Tet|Yodh|Yod|Kaph|Kaf|Lamedh|Lamed|Mem|Nun|Samekh|Ayin|Pe|Tsadhe|Tsadi|Qoph|Qof|Resh|Sin|Shin|Sin and Shin|Taw|Tav)?\s*$/i;

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
    .replace(/\[[A-Za-z][^[\]]*\]/g, " ")
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
  const markers = [...withoutStanzas.matchAll(/<span\b[^>]*\bdata-number="(\d+)(?:-\d+)?"[^>]*>[^<]*<\/span>/g)];
  markers.forEach((marker, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].index : withoutStanzas.length;
    const text = cleanApiBibleText(withoutStanzas.slice(marker.index + marker[0].length, end));
    if (text) verses[marker[1]] = verses[marker[1]] ? `${verses[marker[1]]} ${text}` : text;
  });
  return verses;
}
