import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SavedVerse } from '@/lib/storage';
import { getVerseText as extractVerseText, toSuperscript } from '@/lib/study-chunks';
import { BlurView } from 'expo-blur';
import { useEffect, type RefObject } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewInstance } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Where the control that opened the passage sits on screen, from `measureInWindow`. */
export type PassageOrigin = { x: number; y: number; width: number; height: number };

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const easing = Easing.bezier(...Motion.easing);
const START_SCALE = 0.08;

export function measureOrigin(ref: RefObject<ViewInstance | null>, onOpen: (origin: PassageOrigin) => void) {
  ref.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));
}

/** The passage verse by verse, numbered, from the keyed text when there is some. */
export function passageParts(verse: Pick<SavedVerse, 'verseStart' | 'verseEnd'>, text: string, keyed: Record<string, string>): { n: number; text: string }[] {
  if (!text) return [];
  const total = verse.verseEnd - verse.verseStart + 1;
  if (total === 1) return [{ n: verse.verseStart, text: keyed[verse.verseStart.toString()] || text }];
  const hasKeyed = Object.keys(keyed).length > 0;
  const parts: { n: number; text: string }[] = [];
  for (let i = 0; i < total; i++) {
    const n = verse.verseStart + i;
    // Without keyed text, the deprecated splitter.
    const part = hasKeyed ? keyed[n.toString()] || '' : extractVerseText(text, i, total);
    if (part) parts.push({ n, text: part });
  }
  return parts;
}

/**
 * The whole passage in a card over a blurred page. It grows out of the control that opened it and
 * shrinks back into it on close (`Motion.paneMs`); under Reduce Motion it fades.
 */
export function PassageCard({ origin, reference, parts, onClose }: {
  origin: PassageOrigin;
  reference: string;
  parts: { n: number; text: string }[];
  /** Called once the card is back in its origin. */
  onClose: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const blurMax = scheme === 'dark' ? 40 : 80;
  const dx = origin.x + origin.width / 2 - width / 2;
  const dy = origin.y + origin.height / 2 - height / 2;

  useEffect(() => {
    progress.set(withTiming(1, { duration: Motion.paneMs, easing }));
  }, [progress]);

  const close = () => {
    progress.set(withTiming(0, { duration: Motion.paneMs, easing }, (done) => {
      if (done) scheduleOnRN(onClose);
    }));
  };

  const blur = useAnimatedProps(() => ({ intensity: progress.value * blurMax }));
  const card = useAnimatedStyle(() => {
    const p = progress.value;
    const opacity = interpolate(p, [0, 0.35], [0, 1], 'clamp');
    if (reduced) return { opacity: p };
    return {
      opacity,
      transform: [
        { translateX: dx * (1 - p) },
        { translateY: dy * (1 - p) },
        { scale: START_SCALE + (1 - START_SCALE) * p },
      ],
    };
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <AnimatedBlurView animatedProps={blur} tint={scheme} style={StyleSheet.absoluteFill} />
      <Pressable testID="passage-backdrop" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={close} />
      <View pointerEvents="box-none" style={styles.center}>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card }, card]}
        >
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
              <IconSymbol name="book.fill" size={14} color={colors.tint} />
              <Text style={[styles.badgeText, { color: colors.tint }]}>{reference}</Text>
            </View>
            <Pressable testID="passage-close" accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.text, { color: colors.text }]}>
              {parts.map((part, i) => (
                <Text key={part.n}>
                  <Text style={[styles.number, { color: colors.tint }]}>{toSuperscript(part.n)}</Text>
                  {part.text}{i < parts.length - 1 ? ' ' : ''}
                </Text>
              ))}
            </Text>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: 20 },
  card: {
    maxHeight: '80%',
    borderRadius: Radius.huge,
    paddingTop: 20,
    paddingHorizontal: 22,
    paddingBottom: 26,
    gap: 18,
    boxShadow: Shadows.sheet,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.xxxl },
  badgeText: { fontSize: 14, fontWeight: '600' },
  scroll: { flexGrow: 0 },
  text: { fontSize: 19, lineHeight: 30 },
  number: { fontWeight: '600' },
});
