import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResultCard } from '@/components/study/ResultCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alignTranscription } from '@/lib/align';
import { canDevSignIn } from '@/lib/auth/dev-sign-in';
import { calculateChunkScore } from '@/lib/study-chunks';

/**
 * Dev only: the result card for a verse and a transcript, graded by the real aligner, so
 * `npm run sim -- shot "/dev-result-card?card=<expected>|<transcript>"` can show it without recording.
 * Goes home in a production build or against a non-local Supabase.
 */
export default function DevResultCard() {
  // One param: the dev-sign-in hop that `npm run sim -- shot` uses keeps only the first one.
  const { card = '' } = useLocalSearchParams<{ card?: string }>();
  const [expected, transcript = ''] = card.split('|');
  const allowed = canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL);
  const colors = Colors[useColorScheme() ?? 'light'];

  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed]);

  if (!allowed) return null;
  const alignment = alignTranscription(expected, transcript);
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.card}>
        <ResultCard score={calculateChunkScore(alignment)} alignment={alignment} transcription={transcript} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { padding: 16 },
});
