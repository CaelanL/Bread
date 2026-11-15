import { getVerseText, peekVerseText } from '@/lib/api/bible';
import type { SavedVerse } from '@/lib/storage';
import { useEffect, useRef, useState } from 'react';

/**
 * A verse card's preview text. Text already in memory shows on the first frame, with no loader.
 * A new object for the same verse (a study prefs save) reads nothing again, so the loader never
 * flashes; a failed read is retried when the object is replaced (pull to refresh), keeping the
 * failure text on screen until the answer.
 */
export function useVersePreview(verse: SavedVerse, hideText: boolean) {
  const [text, setText] = useState<string>(() => verse.text || peekVerseText(verse)?.text || '');
  const [loading, setLoading] = useState(!text);
  const read = useRef<{ key: string; failed: boolean } | null>(null);

  useEffect(() => {
    if (verse.text || hideText) return;
    const key = `${verse.id}|${verse.version}`;
    const retry = read.current?.key === key;
    if (retry && !read.current?.failed) return;
    const inMemory = peekVerseText(verse);
    if (inMemory) {
      read.current = { key, failed: false };
      setText(inMemory.text);
      setLoading(false);
      return;
    }
    const attempt = { key, failed: false };
    read.current = attempt;
    if (!retry) setLoading(true);
    // Only the latest read answers: one for a translation changed since is dropped.
    const latest = () => read.current === attempt;
    getVerseText(verse)
      .then(({ text }) => { if (latest()) setText(text); })
      .catch(() => {
        attempt.failed = true;
        if (latest()) setText('Failed to load verse text');
      })
      .finally(() => { if (latest()) setLoading(false); });
  }, [verse, hideText]);

  return { text, loading };
}
