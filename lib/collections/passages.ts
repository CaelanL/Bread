// lib-ok: Curated passage reads validate completeness before preview and import.
import type { BibleVerse, BibleVersion } from '@/lib/api/bible';
import { formatReference } from '@/lib/bible';

import type { CollectionPassage } from './catalog';

type ReadVerse = (reference: string, version: BibleVersion) => Promise<Pick<BibleVerse, 'version' | 'verses'>>;

export function collectionPassageReference({ book, chapter, verseStart, verseEnd }: CollectionPassage) {
  return formatReference({
    book,
    chapter,
    verse: verseStart,
    verseEnd: verseEnd === verseStart ? undefined : verseEnd,
  });
}

export async function readCollectionPassage(
  passage: CollectionPassage,
  version: BibleVersion,
  readVerse: ReadVerse,
  signal?: AbortSignal,
): Promise<string> {
  const reference = collectionPassageReference(passage);
  let result;
  try {
    result = await readVerse(reference, version);
  } catch {
    throw new Error(`Could not load ${reference} in ${version}. Try again or choose another translation.`);
  }
  if (signal?.aborted) throw new Error('Passage preview canceled.');

  const verses = [];
  for (let number = passage.verseStart; number <= passage.verseEnd; number++) {
    const text = result.verses?.[number]?.trim();
    if (result.version !== version || !text) {
      throw new Error(`${reference} is incomplete in ${version}. Try again or choose another translation.`);
    }
    verses.push(text);
  }
  return verses.join(' ');
}

export async function validateCollectionPassages(
  passages: readonly CollectionPassage[],
  version: BibleVersion,
  readVerse: ReadVerse,
): Promise<void> {
  // Limit simultaneous provider requests when a collection has not been previewed.
  const batchSize = 4;
  for (let offset = 0; offset < passages.length; offset += batchSize) {
    await Promise.all(
      passages.slice(offset, offset + batchSize).map((passage) =>
        readCollectionPassage(passage, version, readVerse)
      ),
    );
  }
}
