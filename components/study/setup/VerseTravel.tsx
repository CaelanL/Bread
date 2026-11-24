import { Collapse, linear, phase } from '@/components/study/setup/collapse-motion';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/** Where a resting verse text sits in the collection screen, and how it's set. */
export type VerseFrame = { x: number; y: number; width: number; fontSize: number; lineHeight: number; lines: number };

/** Settings → Hide verses in the verse pane: bronze lines the length of the passage, one per line of text. */
export function HiddenBars({ widths, fontSize, lineHeight, style }: {
  widths: number[];
  fontSize: number;
  lineHeight: number;
  style?: ComponentProps<typeof Animated.View>['style'];
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const barHeight = Math.round(fontSize * 0.6);
  return (
    <Animated.View style={[styles.bars, { gap: lineHeight - barHeight, paddingTop: Math.round((lineHeight - barHeight) / 2) }, style]}>
      {widths.map((percent, i) => (
        <View key={i} style={[styles.bar, { width: `${percent}%`, height: barHeight, backgroundColor: colors.primaryLight }]} />
      ))}
    </Animated.View>
  );
}

/**
 * The verse travelling between the preview card (list showing) and the verse pane (list hidden)
 * while `collapse` runs. Two copies ride the same path and size: the preview's text in its own wrap
 * fades out as the pane's text in its wrap fades in, so neither rewraps mid-flight. Drawn only
 * between the ends; at rest the real texts show. Hide verses: "Verse hidden" becomes the bars.
 */
export function VerseTravel({ collapse, scrollY, from, to, text, hidden, bars }: {
  collapse: SharedValue<number>;
  /** The setup column's scroll, which lifts the preview. */
  scrollY: SharedValue<number>;
  from: VerseFrame;
  to: VerseFrame;
  text: string;
  hidden: boolean;
  /** The pane's bar widths when hidden. */
  bars: number[];
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const ratio = to.fontSize / from.fontSize;

  // Where the copies' top left is at `t`, and how much bigger than the preview's text they are.
  const place = (t: number) => {
    'worklet';
    const move = phase(t, Collapse.textMove);
    const fromY = from.y - scrollY.value;
    return {
      x: from.x + (to.x - from.x) * move,
      y: fromY + (to.y - fromY) * move,
      grow: 1 + (ratio - 1) * move,
      fade: linear(t, Collapse.crossFade),
      flying: t > 0 && t < 1,
    };
  };

  // `size` is the copy's size relative to its own resting size.
  const copy = (frame: VerseFrame, size: number, x: number, y: number, byFont: boolean) => {
    'worklet';
    if (byFont) {
      return {
        transform: [{ translateX: x }, { translateY: y }],
        width: frame.width * size,
        fontSize: frame.fontSize * size,
        lineHeight: frame.lineHeight * size,
      };
    }
    return { width: frame.width, transform: [{ translateX: x }, { translateY: y }, { scale: size }] };
  };

  const small = useAnimatedStyle(() => {
    const { x, y, grow, fade, flying } = place(collapse.value);
    return { opacity: flying ? 1 - fade : 0, ...copy(from, grow, x, y, Collapse.grow === 'fontSize') };
  });
  const big = useAnimatedStyle(() => {
    const { x, y, grow, fade, flying } = place(collapse.value);
    return { opacity: flying ? fade : 0, ...copy(to, grow / ratio, x, y, Collapse.grow === 'fontSize' && !hidden) };
  });

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.Text
        style={[styles.copy, { fontSize: from.fontSize, lineHeight: from.lineHeight, color: hidden ? colors.icon : colors.text }, small]}
        numberOfLines={from.lines}
      >
        {hidden ? 'Verse hidden' : text}
      </Animated.Text>
      {hidden ? (
        <HiddenBars widths={bars} fontSize={to.fontSize} lineHeight={to.lineHeight} style={[styles.copy, big]} />
      ) : (
        <Animated.Text
          style={[styles.copy, { fontSize: to.fontSize, lineHeight: to.lineHeight, color: colors.text }, big]}
          numberOfLines={to.lines}
        >
          {text}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  copy: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  bars: { alignSelf: 'stretch' },
  bar: { borderRadius: Radius.full },
});
