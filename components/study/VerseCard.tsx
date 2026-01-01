import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
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

interface AnimatedWordProps {
  word: DisplayWord;
  index: number;
  revealed: boolean;
  textColor: string;
  underlineColor: string;
}

function AnimatedWord({ word, index, revealed, textColor, underlineColor }: AnimatedWordProps) {
  const opacity = useSharedValue(revealed ? 1 : 0);

  useEffect(() => {
    if (revealed && word.isBlank) {
      opacity.value = withDelay(
        index * STAGGER_DELAY,
        withTiming(1, { duration: 200 })
      );
    }
  }, [revealed]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: word.isBlank ? opacity.value : 1,
  }));

  return (
    <View style={styles.wordWrapper}>
      <Animated.Text
        style={[
          styles.chunkText,
          word.isBlank && styles.blankWord,
          { color: word.isBlank && !revealed ? 'transparent' : textColor },
          animatedStyle,
        ]}
      >
        {word.text}
      </Animated.Text>
      {word.isBlank && !revealed && (
        <View style={[styles.underline, { backgroundColor: underlineColor }]} />
      )}
    </View>
  );
}

interface VerseCardProps {
  chunk: Chunk;
  difficulty: Difficulty;
  verseLabel: string;
  revealed?: boolean;
}

export function VerseCard({ chunk, difficulty, verseLabel, revealed = false }: VerseCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const cardBg = isDark ? '#1c1c1e' : '#ffffff';
  const badgeBg = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(10,126,164,0.1)';
  const accentColor = isDark ? '#60a5fa' : colors.tint;
  const borderColor = isDark ? 'rgba(96,165,250,0.3)' : 'rgba(10,126,164,0.25)';
  const underlineColor = isDark ? '#666' : '#999';

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
          {difficulty === 'hard' && !revealed ? (
            <View style={styles.hardModeContainer}>
              <View style={[styles.hardModeIcon, { backgroundColor: badgeBg }]}>
                <IconSymbol name="lightbulb.fill" size={28} color={accentColor} />
              </View>
              <Text style={[styles.hardModeHint, { color: colors.icon }]}>
                Recite from memory
              </Text>
            </View>
          ) : (
            <View style={styles.wordsContainer}>
              {chunk.displayWords.map((word, i) => (
                <AnimatedWord
                  key={i}
                  word={word}
                  index={i}
                  revealed={revealed}
                  textColor={colors.text}
                  underlineColor={underlineColor}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>
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
  wordsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  wordWrapper: {
    position: 'relative',
    marginRight: 6,
    marginBottom: 4,
  },
  chunkText: {
    fontSize: 19,
    lineHeight: 30,
  },
  blankWord: {
    fontWeight: '600',
  },
  underline: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    height: 1.5,
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
});
