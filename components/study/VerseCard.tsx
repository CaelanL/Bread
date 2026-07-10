import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, Pressable } from 'react-native';
import Animated, {
  Layout,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Chunk, Difficulty, DisplayWord } from '@/lib/study-chunks';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.30;
const SCROLL_MAX_HEIGHT = CARD_MAX_HEIGHT - 28 - 16 - 20 - 20;
const STAGGER_DELAY = 30; // ms between each word

interface InlineWordProps {
  word: DisplayWord;
  index: number;
  revealed: boolean;
  fast: boolean;
  textColor: string;
  underlineColor: string;
}

// Renders a single word as an inline Text span inside the parent paragraph
// Text. Blanks use textDecorationLine for the underline so it stays bonded
// to the glyph instead of an absolutely-positioned sibling that desyncs.
function InlineWord({ word, index, revealed, fast, textColor, underlineColor }: InlineWordProps) {
  const opacity = useSharedValue(revealed || !word.isBlank ? 1 : 0);

  useEffect(() => {
    if (revealed && word.isBlank) {
      // Manual peek reveals run at 2x speed; completion reveals keep
      // the original leisurely stagger.
      opacity.value = withDelay(
        index * (fast ? STAGGER_DELAY / 2 : STAGGER_DELAY),
        withTiming(1, { duration: fast ? 100 : 200 })
      );
    }
  }, [revealed]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: word.isBlank ? opacity.value : 1,
  }));

  const showUnderline = word.isBlank && !revealed;

  return (
    <Animated.Text
      style={[
        word.isBlank && styles.blankWord,
        showUnderline && {
          textDecorationLine: 'underline',
          textDecorationColor: underlineColor,
        },
        { color: showUnderline ? 'transparent' : textColor },
        animatedStyle,
      ]}
    >
      {word.text}
    </Animated.Text>
  );
}

interface VerseCardProps {
  chunk: Chunk;
  difficulty: Difficulty;
  verseLabel: string;
  revealed?: boolean;
  // Reveal came from the peek/hide toggle (2x animation) rather than
  // chunk completion.
  revealFast?: boolean;
  // Easy "all hidden": render the same recite-from-memory placeholder
  // Hard uses instead of the verse text. The card resizes to fit; the
  // Layout animation smooths the change.
  memoryPlaceholder?: boolean;
  // Reveal/hide toggle in the card's top-right. Omit to hide the button.
  visibilityIcon?: 'eye' | 'eye.slash';
  onToggleVisibility?: () => void;
}

export function VerseCard({
  chunk,
  difficulty,
  verseLabel,
  revealed = false,
  revealFast = false,
  memoryPlaceholder = false,
  visibilityIcon = 'eye',
  onToggleVisibility,
}: VerseCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const cardBg = colors.card;
  const badgeBg = colors.primaryLight;
  const accentColor = colors.primary;
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)'; // Bronze gold accent border
  const underlineColor = isDark ? '#666' : '#999'; // Keep underline colors as-is

  return (
    <Animated.View
      style={[
        styles.card,
        styles.cardShadow,
        { backgroundColor: cardBg, maxHeight: CARD_MAX_HEIGHT, borderColor },
      ]}
      layout={Layout.duration(300)}
    >
      <View style={styles.cardContent}>
        {/* Reference Badge */}
        <View style={[styles.referenceBadge, { backgroundColor: badgeBg }]}>
          <IconSymbol name="book.fill" size={14} color={accentColor} />
          <Text style={[styles.referenceBadgeText, { color: accentColor }]}>
            {verseLabel}
          </Text>
        </View>

        {/* Verse Text */}
        <ScrollView
          style={[styles.cardScrollContent, { maxHeight: SCROLL_MAX_HEIGHT }]}
          contentContainerStyle={styles.verseTextContainer}
        >
          {(difficulty === 'hard' || memoryPlaceholder) && !revealed ? (
            <View style={styles.hardModeContainer}>
              <View style={[styles.hardModeIcon, { backgroundColor: badgeBg }]}>
                <IconSymbol name="lightbulb.fill" size={28} color={accentColor} />
              </View>
              <Text style={[styles.hardModeHint, { color: colors.icon }]}>
                Recite from memory
              </Text>
            </View>
          ) : (
            <Text style={styles.chunkText}>
              {chunk.displayWords.map((word, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Text>{' '}</Text>}
                  <InlineWord
                    word={word}
                    index={i}
                    revealed={revealed}
                    fast={revealFast}
                    textColor={colors.text}
                    underlineColor={underlineColor}
                  />
                </React.Fragment>
              ))}
            </Text>
          )}
        </ScrollView>
      </View>

      {onToggleVisibility && (
        <Pressable
          onPress={onToggleVisibility}
          hitSlop={10}
          style={styles.visibilityButton}
        >
          <IconSymbol name={visibilityIcon} size={20} color={colors.icon} />
        </Pressable>
      )}
    </Animated.View>
  );
}

export { CARD_MAX_HEIGHT, SCROLL_MAX_HEIGHT };

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardContent: {
    padding: 20,
  },
  referenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  referenceBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardScrollContent: {
    flexGrow: 0,
  },
  verseTextContainer: {
    paddingBottom: 4,
  },
  chunkText: {
    fontSize: 19,
    lineHeight: 30,
  },
  blankWord: {
    fontWeight: '600',
  },
  hardModeContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  hardModeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  hardModeHint: {
    fontSize: 16,
    textAlign: 'center',
  },
  visibilityButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
});
