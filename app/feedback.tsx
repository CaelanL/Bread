import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedbackForm } from '@/components/settings/FeedbackForm';
import { TopBar, useTopBarHeight } from '@/components/ui/TopBar';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';

/** Settings → Send feedback on a phone. On a wide window Settings shows the form in its own pane, so this page goes back there. */
export default function FeedbackScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const barHeight = useTopBarHeight();
  const insets = useSafeAreaInsets();
  const wide = useWindowClass() === 'wide';

  useEffect(() => {
    if (wide) router.dismissTo({ pathname: '/(tabs)/settings', params: { topic: 'feedback', opened: String(Date.now()) } });
  }, [wide]);
  if (wide) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Clear of the status bar where it runs down the right edge (the Duo's outer display); 0 on an iPhone. */}
      <View style={[styles.container, { paddingRight: insets.right }]}>
        <FeedbackForm contentStyle={{ paddingTop: barHeight }} onDone={() => router.back()} />
      </View>
      <TopBar onBack={() => router.back()} backLabel="Settings" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
