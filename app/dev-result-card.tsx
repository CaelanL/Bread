import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResultCard } from '@/components/study/ResultCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alignTranscription } from '@/lib/align';
import { canDevSignIn } from '@/lib/auth/dev-sign-in';
import { sendGradingReport } from '@/lib/feedback';
import { buildGradingReport } from '@/lib/feedback/grading-report';
import { calculateChunkScore } from '@/lib/study-chunks';

/**
 * Dev only: the result card for a verse and a transcript, graded by the real aligner, so
 * `npm run sim -- shot "/dev-result-card?card=<expected>|<transcript>"` can show it without recording.
 * Goes home in a production build or against a non-local Supabase. Its report button saves a real
 * grading report (KJV text only) under a placeholder reference.
 */
export default function DevResultCard() {
  // One param: the dev-sign-in hop that `npm run sim -- shot` uses keeps only the first one.
  const { card = '' } = useLocalSearchParams<{ card?: string }>();
  const [expected, transcript = ''] = card.split('|');
  const allowed = canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL);
  const colors = Colors[useColorScheme() ?? 'light'];
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed]);

  if (!allowed) return null;
  const alignment = alignTranscription(expected, transcript);
  const result = { score: calculateChunkScore(alignment), transcription: transcript, alignment };
  const report = async (note: string) => {
    await sendGradingReport(buildGradingReport({
      verse: { book: 'Dev card', chapter: 0, verseStart: 0, verseEnd: 0, version: 'KJV' },
      chunk: { verseNum: 0 },
      difficulty: 'easy',
      chunkSize: 1,
      result,
      shown: 'scored',
    }), note);
    setReported(true);
  };
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.card}>
        <ResultCard score={result.score} alignment={alignment} transcription={transcript} onReport={report} reported={reported} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { padding: 16 },
});
