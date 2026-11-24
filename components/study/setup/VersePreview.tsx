import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { measureOrigin, type PassageOrigin } from './PassageCard';

/** The verse's opening lines in a card, with ⤢ at the top right. Tapping the text or ⤢ opens the whole passage from where it was tapped. */
export function VersePreview({ text, loading, hidden, lines, onOpen }: {
  text: string;
  loading: boolean;
  /** Settings → Hide verses: no text, only a placeholder. */
  hidden: boolean;
  lines: number;
  onOpen: (origin: PassageOrigin) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const textRef = useRef<ViewInstance>(null);
  const expandRef = useRef<ViewInstance>(null);

  return (
    <View style={[styles.card, { backgroundColor: colors.cardAlt }]}>
      {loading && !hidden ? (
        <ActivityIndicator size="small" color={colors.icon} style={styles.loader} />
      ) : (
        <Pressable
          ref={textRef}
          testID="verse-preview"
          accessibilityRole="button"
          accessibilityHint="Shows the whole passage"
          onPress={() => measureOrigin(textRef, onOpen)}
        >
          {hidden ? (
            <Text style={[styles.text, { color: colors.icon }]}>Verse hidden</Text>
          ) : (
            <Text style={[styles.text, { color: colors.text }]} numberOfLines={lines}>{text}</Text>
          )}
        </Pressable>
      )}
      <Pressable
        ref={expandRef}
        testID="verse-expand"
        accessibilityRole="button"
        accessibilityLabel="Show the whole passage"
        hitSlop={6}
        onPress={() => measureOrigin(expandRef, onOpen)}
        style={({ pressed }) => [styles.expand, { backgroundColor: colors.primaryLight }, pressed && styles.pressed]}
      >
        <IconSymbol name="arrow.up.left.and.arrow.down.right" size={15} color={colors.tint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xxl, paddingVertical: 14, paddingLeft: 16, paddingRight: 54, minHeight: 52 },
  text: { fontSize: 16, lineHeight: 24 },
  loader: { alignSelf: 'flex-start', marginTop: 2 },
  expand: { position: 'absolute', top: 9, right: 9, width: 34, height: 34, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
