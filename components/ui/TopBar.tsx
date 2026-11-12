import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const BAR_HEIGHT = 44;
// Scroll distance over which the bar's surface fades in.
const EDGE = 32;
// The surface fades from the page colour to clear over this far, from just above the bar's bottom
// edge, so content scrolls out into the bar instead of under a hard line.
const FADE_ABOVE = 8;
const FADE_BELOW = 20;

/** The bar's full height (status bar included): a scroll view's top padding under it. */
export function useTopBarHeight() {
  return useSafeAreaInsets().top + BAR_HEIGHT;
}

/** The scroll offset a `TopBar` reads. Spread `onScroll` on a Reanimated scroll view. */
export function useScrollY() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  return { scrollY, onScroll };
}

/**
 * A screen's bar, floating over its scroll view. It has no surface until content scrolls under it,
 * then the page colour fades in, ending in a soft fade instead of an edge, so content scrolls out into
 * it. The screen's title lives only in its content; the bar never shows one.
 */
export function TopBar({ scrollY, onBack, backLabel = 'Back', children }: {
  scrollY: SharedValue<number>;
  onBack?: () => void;
  backLabel?: string;
  children?: ReactNode;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const solid = insets.top + BAR_HEIGHT - FADE_ABOVE;
  const height = solid + FADE_ABOVE + FADE_BELOW;
  const surface = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, EDGE], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top }]}>
      <Animated.View pointerEvents="none" style={[styles.surface, { height }, surface]}>
        <LinearGradient
          colors={[colors.background, colors.background, withAlpha(colors.background, 0)]}
          locations={[0, solid / height, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View pointerEvents="box-none" style={styles.row}>
        {onBack && <TopBarButton icon="chevron.left" label={backLabel} onPress={onBack} />}
        <View style={styles.spacer} />
        <View style={styles.actions}>{children}</View>
      </View>
    </View>
  );
}

/** A screen's title in its content. `root` is a tab's first screen (34/700), otherwise a pushed page (28/600). */
export function LargeTitle({ title, subtitle, root }: {
  title: string;
  subtitle?: string;
  root?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.large}>
      <Text accessibilityRole="header" style={[root ? styles.rootTitle : styles.pageTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.icon }]}>{subtitle}</Text>}
    </View>
  );
}

/** An icon button in the bar, in the text colour. */
export function TopBarButton({ icon, label, onPress, testID, disabled }: {
  icon: ComponentProps<typeof IconSymbol>['name'];
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <IconSymbol name={icon} size={icon === 'chevron.left' ? 22 : 20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  surface: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  spacer: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  large: { gap: 2 },
  rootTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.4 },
  pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 20 },
});
