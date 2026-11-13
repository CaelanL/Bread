import { Sweep } from '@/components/library/CollectionHeader';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Difficulty } from '@/lib/study-chunks';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const PASS = 90;
const easing = Easing.bezier(...Motion.easing);
const NEXT: Record<Difficulty, string> = {
  easy: 'Medium is next.',
  medium: 'Hard is next.',
  hard: 'Keep reviewing it to engrave it.',
};

/**
 * The page after the last chunk: the score counts up while its line fills toward the 90% mark.
 * A pass lands with a success haptic and the finished line's highlight. Runs once, the first time
 * the page is `active`.
 */
export function SessionFinish({ score, difficulty, reference, active, onDone, onReview }: {
  score: number;
  difficulty: Difficulty;
  reference: string;
  active: boolean;
  onDone: () => void;
  onReview: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const reduced = useReducedMotion();
  const passed = score >= PASS;
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(0);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (!active || landed || progress.value > 0) return;
    const land = () => {
      setLanded(true);
      if (passed && process.env.EXPO_OS === 'ios') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };
    if (reduced) {
      progress.value = score;
      setShown(score);
      land();
      return;
    }
    progress.value = withTiming(score, { duration: Motion.scoreMs, easing }, (finished) => {
      if (finished) scheduleOnRN(land);
    });
  }, [active, landed, passed, progress, reduced, score]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (value, previous) => {
      if (value !== previous) scheduleOnRN(setShown, value);
    },
  );

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value}%` }));
  const tone = landed ? (passed ? colors.success : colors.text) : colors.text;
  const name = difficulty[0].toUpperCase() + difficulty.slice(1);
  const title = passed ? `${name} passed` : score >= 65 ? 'Almost there' : 'Keep practicing';
  const line = passed ? NEXT[difficulty] : `${PASS}% to pass`;

  if (!active && !landed) return <View style={styles.page} />;

  return (
    <View style={styles.page}>
      <View style={styles.body}>
        <Animated.Text entering={FadeInDown.duration(Motion.expandMs)} style={[styles.eyebrow, { color: colors.icon }]}>
          {reference.toUpperCase()} · {name.toUpperCase()}
        </Animated.Text>

        <Animated.View entering={FadeInDown.duration(Motion.expandMs).delay(Motion.staggerMs)}>
          <Text accessibilityLabel={`Score ${score} percent`} style={[styles.score, { color: tone }]}>
            {shown}
            <Text style={styles.percent}>%</Text>
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(Motion.expandMs).delay(Motion.staggerMs * 2)} style={styles.lineWrap}>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <Animated.View style={[styles.fill, fillStyle, !passed && { backgroundColor: colors.text }]}>
              {passed && (
                <LinearGradient
                  colors={[colors.masteredBarStart, colors.masteredBarEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              {passed && landed && <Sweep color={colors.white} />}
            </Animated.View>
          </View>
          <View style={[styles.mark, { left: `${PASS}%`, backgroundColor: colors.icon }]} />
          <Text style={[styles.markLabel, { left: `${PASS}%`, color: colors.icon }]}>{PASS}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(Motion.expandMs).delay(Motion.staggerMs * 3)} style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>{line}</Text>
        </Animated.View>
      </View>

      <Animated.View entering={FadeInDown.duration(Motion.expandMs).delay(Motion.staggerMs * 4)} style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.done, { backgroundColor: colors.text }, pressed && styles.pressed]}
        >
          <Text style={[styles.doneText, { color: colors.background }]}>Done</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onReview} style={({ pressed }) => [styles.review, pressed && styles.pressed]}>
          <Text style={[styles.reviewText, { color: colors.icon }]}>Review chunks</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 28 },
  body: { flex: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontWeight: '600', letterSpacing: 1.2 },
  score: { marginTop: 10, fontSize: 88, lineHeight: 96, fontWeight: '700', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  percent: { fontSize: 40, fontWeight: '600', letterSpacing: 0 },
  lineWrap: { marginTop: 16, paddingBottom: 18 },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, overflow: 'hidden' },
  mark: { position: 'absolute', top: -4, width: 1.5, height: 14, marginLeft: -0.75 },
  markLabel: { position: 'absolute', top: 12, width: 24, marginLeft: -12, textAlign: 'center', fontSize: 11, fontWeight: '500', fontVariant: ['tabular-nums'] },
  copy: { marginTop: 22, gap: 6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { fontSize: 16, lineHeight: 22 },
  actions: { paddingBottom: 8, gap: 4 },
  done: { height: 54, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 17, fontWeight: '600' },
  review: { height: 44, alignItems: 'center', justifyContent: 'center' },
  reviewText: { fontSize: 15, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});
