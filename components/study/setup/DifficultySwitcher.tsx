import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

export type Difficulty = 'easy' | 'medium' | 'hard';

const LEVELS: { level: Difficulty; label: string; sub: string }[] = [
  { level: 'easy', label: 'Easy', sub: 'All words' },
  { level: 'medium', label: 'Medium', sub: 'Some hidden' },
  { level: 'hard', label: 'Hard', sub: 'No words' },
];
const PAD = 3;
const easing = Easing.bezier(...Motion.easing);

/** "Difficulty" and an iOS-style switcher: a capsule track with a raised thumb that slides to the chosen level. */
export function DifficultySwitcher({ value, onChange }: {
  value: Difficulty;
  onChange: (level: Difficulty) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const reduced = useReducedMotion();
  const [segment, setSegment] = useState(0);
  const index = LEVELS.findIndex((l) => l.level === value);
  const x = useSharedValue(index * segment);

  const laidOut = useRef(segment);

  // Slides only when the level changes; a first layout or a new width puts the thumb in place.
  useEffect(() => {
    const target = index * segment;
    const resized = laidOut.current !== segment;
    laidOut.current = segment;
    x.set(reduced || resized ? target : withTiming(target, { duration: Motion.expandMs, easing }));
  }, [index, segment, reduced, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.text }]}>Difficulty</Text>
      <View
        style={[styles.track, { backgroundColor: colors.controlFill }]}
        onLayout={(e) => setSegment((e.nativeEvent.layout.width - PAD * 2) / LEVELS.length)}
      >
        {segment > 0 && (
          <Animated.View style={[styles.thumb, { width: segment, backgroundColor: colors.controlThumb }, thumb]} />
        )}
        {LEVELS.map(({ level, label, sub }) => (
          <Pressable
            key={level}
            accessibilityRole="button"
            accessibilityState={{ selected: value === level }}
            style={styles.segment}
            onPress={() => onChange(level)}
          >
            <View style={styles.segmentHeader}>
              <Text style={[styles.segmentText, { color: colors.text }]}>{label}</Text>
              {level === 'easy' && <View style={[styles.dot, styles.easyDot]} />}
              {level === 'medium' && <View style={[styles.dot, styles.mediumDot]} />}
              {level === 'hard' && <IconSymbol name="checkmark" size={12} color={colors.success} />}
            </View>
            <Text style={[styles.segmentSub, { color: colors.icon }]}>{sub}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  title: { fontSize: 17, fontWeight: '600', paddingHorizontal: 2 },
  track: { flexDirection: 'row', padding: PAD, borderRadius: Radius.full },
  thumb: { position: 'absolute', top: PAD, bottom: PAD, left: PAD, borderRadius: Radius.full, boxShadow: Shadows.thumb },
  segment: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' },
  segmentHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  segmentText: { fontSize: 14, fontWeight: '600' },
  // eslint-disable-next-line no-restricted-syntax -- a 7 pt dot, the collection rows' legend mark
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  // The collection rows' legend colours (status colours, the same in both themes).
  easyDot: { backgroundColor: '#a5a5a5' },
  mediumDot: { backgroundColor: '#1d4ed8' },
  segmentSub: { fontSize: 10, marginTop: 1 },
});
