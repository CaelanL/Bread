import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassButton, GlassPill } from '@/components/ui/Glass';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { canDevSignIn } from '@/lib/auth/dev-sign-in';
import { windowClass } from '@/lib/layout';

/**
 * Dev only: the window size and its layout class, live, so a shot of
 * `npm run sim -- shot /dev-window --device duo` shows what the app gets in each posture. Below them,
 * the glass primitives over a strip of text, to see them in light and dark.
 * Goes home in a production build or against a non-local Supabase.
 */
export default function DevWindow() {
  const allowed = canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL);
  const { width, height } = useWindowDimensions();
  const colors = Colors[useColorScheme() ?? 'light'];

  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed]);

  if (!allowed) return null;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.size, { color: colors.text }]}>{`${Math.round(width)} × ${Math.round(height)}`}</Text>
      <Text style={[styles.class, { color: colors.icon }]}>{windowClass(width, height)}</Text>
      <View style={styles.glass}>
        <Text style={[styles.behind, { color: colors.primary }]}>Glass over text, glass over text</Text>
        <View style={styles.row}>
          <GlassButton icon="chevron.left" label="Back" onPress={() => {}} />
          <GlassButton icon="ellipsis" label="More" onPress={() => {}} />
          <GlassPill><Text style={[styles.pillText, { color: colors.text }]}>Psalms 23:1-3</Text></GlassPill>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  size: { fontSize: 34, fontWeight: '700' },
  class: { fontSize: 22 },
  glass: { marginTop: 32, justifyContent: 'center' },
  behind: { position: 'absolute', fontSize: 34, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pillText: { fontSize: 17, fontWeight: '600' },
});
