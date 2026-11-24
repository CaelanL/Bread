import { GlassPill } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, type ViewInstance } from 'react-native';
import { measureOrigin, type PassageOrigin } from './PassageCard';

/** Study setup's title (the screen's VoiceOver heading): the reference in a glass bubble. Tapping it opens the whole passage. */
export function ReferenceBubble({ reference, onOpen }: {
  reference: string;
  onOpen: (origin: PassageOrigin) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const ref = useRef<ViewInstance>(null);
  return (
    <Pressable
      ref={ref}
      testID="reference-bubble"
      accessibilityRole="header"
      accessibilityLabel={reference}
      accessibilityHint="Shows the whole passage"
      onPress={() => measureOrigin(ref, onOpen)}
      style={({ pressed }) => [styles.press, pressed && styles.pressed]}
    >
      <GlassPill style={styles.pill}>
        <IconSymbol name="book.fill" size={16} color={colors.tint} />
        <Text numberOfLines={1} style={[styles.text, { color: colors.text }]}>{reference}</Text>
        <IconSymbol name="chevron.down" size={12} color={colors.icon} />
      </GlassPill>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { maxWidth: '100%' },
  pill: { paddingLeft: 14, paddingRight: 16 },
  text: { flexShrink: 1, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  pressed: { opacity: 0.6 },
});
