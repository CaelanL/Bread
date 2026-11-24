import type { Difficulty } from '@/components/study/setup/DifficultySwitcher';
import { getVerseText as fetchVerseText } from '@/lib/api/bible';
import { useAppStore, useVerse } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

/**
 * Study setup for one verse: its text, the difficulty and chunk size (restored once, saved on every
 * change), Start and Reset Progress. The phone screen and the wide panes share it.
 */
export function useStudySetup(id: string) {
  // Get verse from store (instant, no loading)
  const verse = useVerse(id);
  const resetVerseProgress = useAppStore((s) => s.resetVerseProgress);

  const [verseText, setVerseText] = useState<string>('');
  const [verseKeyed, setVerseKeyed] = useState<Record<string, string>>({});
  const [textLoading, setTextLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [chunkSize, setChunkSize] = useState(1);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Calculate total verses in this passage
  const totalVerses = verse ? verse.verseEnd - verse.verseStart + 1 : 1;

  // Restore the last setup the user chose for this verse (saved when
  // a session starts). A mastered verse with nothing saved yet (all
  // pre-migration-021 masteries) falls back to the review setup —
  // Hard, whole passage — because engraved reviews only qualify on
  // Hard; defaulting to Easy would silently stall the review loop.
  // Everything else falls back to easy / 1-verse chunks. Runs once
  // after the verse loads; the defaultsApplied gate keeps it from
  // fighting the user's choice on re-render. Saved chunk size is
  // clamped in case it exceeds this passage's verse count.
  useEffect(() => {
    if (!verse || defaultsApplied) return;
    const mastered = verse.progress?.hard?.completed === true;
    setDifficulty(verse.lastDifficulty ?? (mastered ? 'hard' : 'easy'));
    setChunkSize(
      verse.lastChunkSize != null
        ? Math.min(verse.lastChunkSize, totalVerses)
        : mastered ? totalVerses : 1,
    );
    setDefaultsApplied(true);
  }, [verse, defaultsApplied, totalVerses]);

  // Load verse text (both combined and keyed)
  useEffect(() => {
    if (verse) {
      if (verse.text && verse.verses) {
        // Already have both formats
        setVerseText(verse.text);
        setVerseKeyed(verse.verses);
      } else if (verse.text && !verse.verses) {
        // Have text but no keyed data - fetch to get keyed
        setVerseText(verse.text);
        setTextLoading(true);
        fetchVerseText(verse)
          .then(({ verses }) => setVerseKeyed(verses))
          .catch(() => {})
          .finally(() => setTextLoading(false));
      } else {
        // Need to fetch both
        setTextLoading(true);
        fetchVerseText(verse)
          .then(({ text, verses }) => {
            setVerseText(text);
            setVerseKeyed(verses);
          })
          .catch(() => setVerseText('Failed to load verse text'))
          .finally(() => setTextLoading(false));
      }
    }
    // Keyed on the verse *reference*, not the object: saving study
    // prefs swaps the verse's identity in the store, and re-running
    // this effect then flashes the text loader over already-loaded
    // text (visible as a flicker when starting a session).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verse?.id, verse?.version]);

  // Persist the setup whenever the user changes it, so prefs stick
  // even without starting a session. The store action no-ops when
  // values are unchanged.
  const savePrefs = (nextChunkSize: number, nextDifficulty: Difficulty) => {
    if (!id) return;
    useAppStore.getState().setVerseStudyPrefs(id, nextChunkSize, nextDifficulty);
  };

  const pickDifficulty = (level: Difficulty) => {
    setDifficulty(level);
    savePrefs(chunkSize, level);
  };

  const pickChunkSize = (size: number) => {
    setChunkSize(size);
    savePrefs(size, difficulty);
  };

  const handleStartSession = () => {
    if (!verse || !id) return;
    savePrefs(chunkSize, difficulty);
    // Session is at root level, outside tabs
    router.push(`/session?id=${id}&difficulty=${difficulty}&chunkSize=${chunkSize}`);
  };

  const handleResetProgress = () => {
    if (!verse || !id) return;

    const isMastered = verse.progress?.hard?.completed === true;
    const message = isMastered
      ? 'This will clear all scores and review progress, and remove this verse from your Mastered list.'
      : 'This will clear all your scores for this verse.';

    Alert.alert('Reset Progress?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetVerseProgress(id).catch(() => showErrorToast("Couldn't reset progress. Try again."));
        },
      },
    ]);
  };

  return {
    verse,
    verseText,
    verseKeyed,
    textLoading,
    difficulty,
    chunkSize,
    totalVerses,
    pickDifficulty,
    pickChunkSize,
    handleStartSession,
    handleResetProgress,
  };
}

export type StudySetup = ReturnType<typeof useStudySetup>;
