import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { canDevSignIn } from '@/lib/auth/dev-sign-in';
import { windowClass } from '@/lib/layout';

/**
 * Dev only: the window size and its layout class, live, so a shot of
 * `npm run sim -- shot /dev-window --device duo` shows what the app gets in each posture.
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  size: { fontSize: 34, fontWeight: '700' },
  class: { fontSize: 22 },
});
