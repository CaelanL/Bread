import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AlignmentWord } from '@/lib/study-chunks';
import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { AlignmentHelpModal } from './AlignmentHelpModal';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.30;

type ResultStatus = 'success' | 'partial' | 'retry';

interface ResultCardProps {
  score: number;
  alignment?: AlignmentWord[];
  transcription?: string;
  isRetry?: boolean;
  exiting?: boolean;
  onExitComplete?: () => void;
}

const STATUS_CONFIG = {
  success: {
    icon: 'checkmark.circle.fill' as const,
    label: 'Perfect!',
    color: '#22c55e',
  },
  partial: {
    icon: 'checkmark.circle' as const,
    label: 'Good effort!',
    color: '#f59e0b',
  },
  retry: {
    icon: 'xmark' as const,
    label: 'Keep Practicing',
    color: '#ef4444',
  },
};

export function getStatus(score: number): ResultStatus {
  if (score >= 90) return 'success';
  if (score >= 65) return 'partial';
  return 'retry';
}

export function getScoreColor(score: number): string {
  return STATUS_CONFIG[getStatus(score)].color;
}

function getStatusColors(status: ResultStatus, isDark: boolean) {
  const color = STATUS_CONFIG[status].color;
  return {
    bg: isDark ? `${color}1a` : `${color}14`, // 10% and 8% opacity
    border: `${color}4d`, // 30% opacity
    text: color,
  };
}

/**
 * Custom entering animation for the result card
 */
const customEntering = () => {
  'worklet';
  const animConfig = { duration: 400, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94) };
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 30 }, { scale: 0.95 }],
    },
    animations: {
      opacity: withDelay(100, withTiming(1, animConfig)),
      transform: [
        { translateY: withDelay(100, withTiming(0, animConfig)) },
        { scale: withDelay(100, withTiming(1, animConfig)) },
      ],
    },
  };
};


// Colors for alignment statuses
const ALIGNMENT_COLORS = {
  destructive: '#ef4444', // red for missing
  warning: '#f59e0b',     // amber for added/close
};

/**
 * Renders a single word with appropriate styling based on status
 */
function Word({ item, textColor }: { item: AlignmentWord; textColor: string }) {
  switch (item.status) {
    case 'correct':
      return <Text style={{ color: textColor }}>{item.word}</Text>;

    case 'missing':
      // Red + strikethrough + slight opacity (word user should have said)
      return (
        <Text style={styles.missingWord}>
          {item.word}
        </Text>
      );

    case 'added':
      // Amber + underline (word user said but shouldn't have)
      return (
        <Text style={styles.addedWord}>
          {item.word}
        </Text>
      );

    case 'close':
      // Amber background (future: synonym/near-match)
      return (
        <Text style={styles.closeWord}>
          {item.word}
        </Text>
      );

    default:
      return <Text style={{ color: textColor }}>{item.word}</Text>;
  }
}

/**
 * Renders word alignment with color-coded status
 */
function AlignmentDisplay({ alignment, textColor }: { alignment: AlignmentWord[]; textColor: string }) {
  return (
    <Text style={styles.alignmentContainer}>
      {alignment.map((item, i) => (
        <Text key={i}>
          <Word item={item} textColor={textColor} />
          {i < alignment.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
}

export function ResultCard({ score, alignment, transcription, isRetry = false, exiting = false, onExitComplete }: ResultCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const [showHelp, setShowHelp] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(0);

  const status = getStatus(score);
  const statusConfig = STATUS_CONFIG[status];
  const statusColors = getStatusColors(status, isDark);

  // Exit animation: fade out + collapse height
  const exitOpacity = useSharedValue(1);
  const exitHeight = useSharedValue(-1); // -1 = use auto height

  useEffect(() => {
    if (exiting && measuredHeight > 0) {
      const config = { duration: 300, easing: Easing.bezier(0.4, 0.0, 0.65, 0.15) };
      exitOpacity.value = withTiming(0, config);
      exitHeight.value = measuredHeight;
      exitHeight.value = withTiming(0, config, (finished) => {
        if (finished && onExitComplete) {
          runOnJS(onExitComplete)();
        }
      });
    }
  }, [exiting, measuredHeight]);

  const exitAnimStyle = useAnimatedStyle(() => {
    if (exitHeight.value === -1) {
      return { opacity: exitOpacity.value };
    }
    return {
      opacity: exitOpacity.value,
      maxHeight: exitHeight.value,
    };
  });

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: statusColors.bg,
          borderColor: statusColors.border,
          maxHeight: exiting ? undefined : CARD_MAX_HEIGHT,
        },
        exitAnimStyle,
      ]}
      entering={customEntering}
      onLayout={(e) => {
        if (!exiting && measuredHeight === 0) {
          setMeasuredHeight(e.nativeEvent.layout.height);
        }
      }}
    >
      <View style={styles.cardContent}>
        {/* Retry notice */}
        {isRetry && (
          <View style={styles.retryBanner}>
            <IconSymbol name="arrow.counterclockwise" size={12} color={colors.icon} />
            <Text style={[styles.retryBannerText, { color: colors.icon }]}>
              Retries don't affect your score
            </Text>
          </View>
        )}

        {/* Header with status */}
        <View style={styles.header}>
          <View style={styles.statusRow}>
            <IconSymbol name={statusConfig.icon as any} size={18} color={statusColors.text} />
            <Text style={[styles.statusLabel, { color: statusColors.text }]}>
              {statusConfig.label}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable onPress={() => setShowHelp(true)} hitSlop={8}>
              <IconSymbol name="questionmark.circle" size={18} color={statusColors.text} />
            </Pressable>
            <View style={[styles.scoreBadge, { backgroundColor: `${statusColors.text}20` }]}>
              <Text style={[styles.scoreBadgeText, { color: statusColors.text }]}>
                {score}% match
              </Text>
            </View>
          </View>
        </View>

        {/* Transcription/Alignment */}
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollInner}>
          {alignment && alignment.length > 0 ? (
            <AlignmentDisplay alignment={alignment} textColor={colors.text} />
          ) : transcription ? (
            <Text style={[styles.transcriptionText, { color: colors.text }]}>
              "{transcription}"
            </Text>
          ) : null}
        </ScrollView>
      </View>

      <AlignmentHelpModal visible={showHelp} onClose={() => setShowHelp(false)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContent: {
    flexGrow: 0,
  },
  scrollInner: {
    paddingBottom: 4,
  },
  alignmentContainer: {
    fontSize: 16,
    lineHeight: 26,
  },
  transcriptionText: {
    fontSize: 16,
    lineHeight: 26,
  },
  // Missing: red + strikethrough + opacity (word user should have said)
  missingWord: {
    color: '#ef4444',
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  // Added: amber + underline (word user said but shouldn't have)
  addedWord: {
    color: '#f59e0b',
    textDecorationLine: 'underline',
  },
  retryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  retryBannerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Close: amber background (future: synonym/near-match)
  closeWord: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 2,
    paddingHorizontal: 2,
  },
});
