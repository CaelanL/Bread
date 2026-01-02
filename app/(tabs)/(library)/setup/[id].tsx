import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatVerseReference, type SavedVerse } from '@/lib/storage';
import { toSuperscript, getVerseText as extractVerseText } from '@/lib/study-chunks';
import { getVerseText as fetchVerseText } from '@/lib/api/bible';
import { useVerse, useAppStore } from '@/lib/store';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import DropDownPicker from 'react-native-dropdown-picker';

type Difficulty = 'easy' | 'medium' | 'hard';

export default function StudySetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Get verse from store (instant, no loading)
  const verse = useVerse(id || '');
  const resetVerseProgress = useAppStore((s) => s.resetVerseProgress);

  const [verseText, setVerseText] = useState<string>('');
  const [textLoading, setTextLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [chunkSize, setChunkSize] = useState(1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownItems, setDropdownItems] = useState<{label: string; value: number}[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  // Calculate total verses in this passage
  const totalVerses = verse ? verse.verseEnd - verse.verseStart + 1 : 1;

  // Update dropdown items when verse loads
  useEffect(() => {
    if (verse) {
      const total = verse.verseEnd - verse.verseStart + 1;
      const items = Array.from({ length: total }, (_, i) => ({
        label: String(i + 1),
        value: i + 1,
      }));
      setDropdownItems(items);
    }
  }, [verse]);

  // Load verse text
  useEffect(() => {
    if (verse) {
      if (verse.text) {
        setVerseText(verse.text);
      } else {
        setTextLoading(true);
        fetchVerseText(verse)
          .then(setVerseText)
          .catch(() => setVerseText('Failed to load verse text'))
          .finally(() => setTextLoading(false));
      }
    }
  }, [verse]);

  const handleStartSession = () => {
    if (!verse) return;
    // Session is at root level, outside tabs
    router.push(`/session?id=${id}&difficulty=${difficulty}&chunkSize=${chunkSize}`);
  };

  const handleResetProgress = () => {
    if (!verse || !id) return;

    const isMastered = verse.progress?.hard?.completed === true;
    const message = isMastered
      ? 'This will clear all scores and remove this verse from your Mastered list.'
      : 'This will clear all your scores for this verse.';

    Alert.alert('Reset Progress?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => resetVerseProgress(id),
      },
    ]);
  };

  const buttonBg = colors.primary;
  const accentColor = colors.tint;
  const badgeBg = colors.primaryLight;

  // Build annotated text with superscript verse numbers (same as VerseCard)
  const getAnnotatedText = () => {
    if (!verse || !verseText) return '';
    const total = verse.verseEnd - verse.verseStart + 1;

    if (total === 1) {
      return `${toSuperscript(verse.verseStart)}${verseText}`;
    }

    // Multi-verse: annotate each verse
    const parts: string[] = [];
    for (let i = 0; i < total; i++) {
      const extracted = extractVerseText(verseText, i, total);
      parts.push(`${toSuperscript(verse.verseStart + i)}${extracted}`);
    }
    return parts.join(' ');
  };

  if (!verse) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <AppHeader title="Setup" />
        <Text style={{ color: colors.text }}>Verse not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Setup"
        rightButton={{
          label: '',
          icon: 'ellipsis',
          onPress: () => setMenuVisible(true),
          variant: 'text',
        }}
      />

      <PopoverMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        anchorPosition={{ top: 105, right: 16 }}
        items={[
          {
            label: 'Reset Progress',
            icon: 'arrow.counterclockwise',
            onPress: handleResetProgress,
            destructive: true,
          },
        ]}
      />

      <View style={styles.content}>
        {/* Verse Preview */}
        <View style={[styles.previewCard, { backgroundColor: colors.cardAlt }]}>
          <View style={[styles.referenceBadge, { backgroundColor: badgeBg }]}>
            <IconSymbol name="book.fill" size={14} color={accentColor} />
            <Text style={[styles.referenceBadgeText, { color: accentColor }]}>
              {formatVerseReference(verse)}
            </Text>
          </View>
          <Pressable
            style={[styles.expandButton, { backgroundColor: badgeBg }]}
            onPress={() => setExpanded(true)}
          >
            <IconSymbol name="arrow.up.left.and.arrow.down.right" size={14} color={accentColor} />
          </Pressable>
          {textLoading ? (
            <ActivityIndicator size="small" color={colors.icon} style={styles.textLoader} />
          ) : (
            <Text style={[styles.previewText, { color: colors.text }]} numberOfLines={4}>
              {verseText}
            </Text>
          )}
        </View>

        {/* Expanded Modal */}
        <Modal
          visible={expanded}
          transparent
          animationType="fade"
          onRequestClose={() => setExpanded(false)}
        >
          <BlurView intensity={isDark ? 40 : 80} tint={isDark ? 'dark' : 'light'} style={styles.blurOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={[styles.referenceBadge, { backgroundColor: badgeBg, marginBottom: 0 }]}>
                  <IconSymbol name="book.fill" size={14} color={accentColor} />
                  <Text style={[styles.referenceBadgeText, { color: accentColor }]}>
                    {formatVerseReference(verse)}
                  </Text>
                </View>
                <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
                  <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
                </Pressable>
              </View>

              {/* Full scrollable verse text */}
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.modalVerseText, { color: colors.text }]}>
                  {getAnnotatedText()}
                </Text>
              </ScrollView>
            </View>
          </BlurView>
        </Modal>

        {/* Difficulty Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Difficulty</Text>
          <View style={[styles.segmentedControl, { backgroundColor: colors.cardAlt }]}>
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((level) => (
              <Pressable
                key={level}
                style={[
                  styles.segment,
                  difficulty === level && { backgroundColor: buttonBg },
                ]}
                onPress={() => setDifficulty(level)}
              >
                <View style={styles.segmentHeader}>
                  <Text
                    style={[
                      styles.segmentText,
                      { color: difficulty === level ? colors.white : colors.text },
                    ]}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Text>
                  {level === 'easy' && (
                    <View style={[styles.difficultyDot, { backgroundColor: '#eab308' }]} />
                  )}
                  {level === 'medium' && (
                    <View style={[styles.difficultyDot, { backgroundColor: '#1d4ed8' }]} />
                  )}
                  {level === 'hard' && (
                    <IconSymbol name="checkmark" size={12} color={colors.success} />
                  )}
                </View>
                <Text
                  style={[
                    styles.segmentSubtext,
                    { color: difficulty === level ? 'rgba(255,255,255,0.7)' : colors.icon }, // Keep rgba for text on colored bg
                  ]}
                >
                  {level === 'easy' && 'All words'}
                  {level === 'medium' && 'Some hidden'}
                  {level === 'hard' && 'No words'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Progress Stats */}
        <View style={styles.progressSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Progress</Text>
          <View style={styles.progressRow}>
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((level) => {
              const progress = verse.progress[level];
              const hasScore = progress.bestAccuracy !== null;
              return (
                <View key={level} style={styles.progressItem}>
                  <Text style={[styles.progressLabel, { color: colors.icon }]}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Text>
                  <Text
                    style={[
                      styles.progressValue,
                      {
                        color: progress.completed
                          ? colors.success
                          : hasScore
                          ? colors.warning
                          : colors.icon,
                      },
                    ]}
                  >
                    {hasScore ? `${progress.bestAccuracy}%` : '--'}
                    {progress.completed && ' ✓'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Chunk Size Selection - only show if multiple verses */}
        {totalVerses > 1 && (
          <View style={[styles.chunkRow, { zIndex: 1000 }]}>
            <Text style={[styles.chunkLabel, { color: colors.text }]}>Verses per chunk</Text>
            <DropDownPicker
              open={dropdownOpen}
              value={chunkSize}
              items={dropdownItems}
              setOpen={setDropdownOpen}
              setValue={setChunkSize}
              setItems={setDropdownItems}
              style={[styles.dropdown, { backgroundColor: colors.cardAlt, borderWidth: 0 }]}
              dropDownContainerStyle={[styles.dropdownContainer, { backgroundColor: colors.cardAlt, borderWidth: 0 }]}
              textStyle={{ color: colors.text, fontSize: 16, fontWeight: '600' }}
              arrowIconStyle={{ tintColor: colors.icon } as any}
              tickIconStyle={{ tintColor: colors.text } as any}
              listItemLabelStyle={{ color: colors.text }}
              selectedItemContainerStyle={{ backgroundColor: colors.border }}
              containerStyle={{ width: 60 }}
              showTickIcon={false}
            />
          </View>
        )}

        {/* Start Button */}
        <View style={styles.bottomSection}>
          <Pressable
            style={[styles.startButton, { backgroundColor: colors.primary }]}
            onPress={handleStartSession}
          >
            <IconSymbol name="play.fill" size={24} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  referenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  referenceBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  expandButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
    borderRadius: 8,
  },
  previewText: {
    fontSize: 16,
    lineHeight: 24,
  },
  textLoader: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  // Modal styles
  blurOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 20,
    maxHeight: '80%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalVerseText: {
    fontSize: 19,
    lineHeight: 30,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '600',
  },
  difficultyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  segmentSubtext: {
    fontSize: 11,
    marginTop: 2,
  },
  progressSection: {
    marginBottom: 24,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
  },
  progressItem: {
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  progressValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  chunkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  chunkLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  dropdown: {
    borderRadius: 10,
    minHeight: 44,
  },
  dropdownContainer: {
    borderRadius: 10,
  },
  bottomSection: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 20,
  },
  startButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
