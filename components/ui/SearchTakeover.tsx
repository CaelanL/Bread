import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, InputText, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

export const SEARCH_FIELD_HEIGHT = 36;
const CANCEL_WIDTH = 64;
const SIDE = 16;
const easing = Easing.bezier(...Motion.easing);

/** Where the search pill sat on screen, measured with `measureInWindow`. */
export type SearchOrigin = { x: number; y: number; width: number; height: number };

/**
 * Search that takes the screen: the field grows out of the pill it was opened from and lifts to
 * the top while the page fades under a plain surface, and Cancel sends it back the way it came.
 * `children` are the results, laid out under the field. Reduced motion: the field appears at the
 * top and everything fades.
 */
export function SearchTakeover({ origin, query, onChangeQuery, onClose, placeholder, children }: {
  origin: SearchOrigin;
  query: string;
  onChangeQuery: (text: string) => void;
  /** Called once the exit has finished. */
  onClose: () => void;
  placeholder: string;
  children: ReactNode;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [closing, setClosing] = useState(false);
  const top = insets.top + 4;
  const fieldWidth = width - SIDE * 2 - CANCEL_WIDTH;

  useEffect(() => {
    progress.value = withTiming(1, { duration: Motion.expandMs, easing });
  }, [progress]);

  const cancel = () => {
    if (closing) return;
    setClosing(true);
    onChangeQuery('');
    progress.value = withTiming(0, { duration: Motion.exitMs, easing }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
  };

  const surface = useAnimatedStyle(() => ({ opacity: progress.value }));
  const field = useAnimatedStyle(() => (reduced
    ? { top, left: SIDE, width: fieldWidth, opacity: progress.value }
    : {
      top: interpolate(progress.value, [0, 1], [origin.y + (origin.height - SEARCH_FIELD_HEIGHT) / 2, top]),
      left: interpolate(progress.value, [0, 1], [origin.x, SIDE]),
      width: interpolate(progress.value, [0, 1], [origin.width, fieldWidth]),
    }));
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: reduced ? 0 : (1 - progress.value) * 12 }],
  }));
  const results = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * 12 }],
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }, surface]} />
      <Animated.View style={[styles.results, { top: top + SEARCH_FIELD_HEIGHT + 8 }, results]}>
        {children}
      </Animated.View>
      <Animated.View style={[styles.field, { backgroundColor: colors.fill }, field]}>
        <IconSymbol name="magnifyingglass" size={14} color={colors.icon} />
        <TextInput
          testID="collection-search"
          style={[styles.input, { color: colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={colors.icon}
          value={query}
          onChangeText={onChangeQuery}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </Animated.View>
      <Animated.View style={[styles.cancel, { top }, cancelStyle]}>
        <Pressable testID="collection-search-cancel" accessibilityRole="button" hitSlop={8} onPress={cancel} style={styles.cancelButton}>
          <Text style={[styles.cancelText, { color: colors.tint }]}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Over the screen's TopBar (zIndex 1).
  layer: { zIndex: 2 },
  results: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  field: {
    position: 'absolute',
    height: SEARCH_FIELD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.full,
  },
  input: { ...InputText, flex: 1, fontSize: 16, padding: 0 },
  cancel: { position: 'absolute', right: SIDE, width: CANCEL_WIDTH, height: SEARCH_FIELD_HEIGHT, justifyContent: 'center', alignItems: 'flex-end' },
  cancelButton: { paddingLeft: 8 },
  cancelText: { fontSize: 17 },
});
