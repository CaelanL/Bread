import { AppHeader } from '@/components/app-header';
import { ProgressCard } from '@/components/study/ProgressCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getVerseText as fetchVerseText } from '@/lib/api/bible';
import { formatVerseReference } from '@/lib/storage';
import { useAppStore, useVerse } from '@/lib/store';
import { getVerseText as extractVerseText, toSuperscript } from '@/lib/study-chunks';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';

type Difficulty = 'easy' | 'medium' | 'hard';

// Screen height thresholds for verse preview lines
// Pro Max (956pts) > 920 → 4 lines, 16 Pro (874pts) > 870 → 3 lines, else → 2 lines
const LARGE_SCREEN_THRESHOLD = 920;
const MEDIUM_SCREEN_THRESHOLD = 870;

export default function StudySetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Detect screen size and set verse preview lines accordingly
  const screenHeight = Dimensions.get('window').height;
  const versePreviewLines = screenHeight > LARGE_SCREEN_THRESHOLD ? 4
    : screenHeight > MEDIUM_SCREEN_THRESHOLD ? 3
    : 2;

  // Get verse from store (instant, no loading)
  const verse = useVerse(id || '');
  const resetVerseProgress = useAppStore((s) => s.resetVerseProgress);

  const [verseText, setVerseText] = useState<string>('');
  const [verseKeyed, setVerseKeyed] = useState<Record<string, string>>({});
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

  // Load verse text (both combined and keyed)
  useEffect(() => {
    if (verse) {
      if (verse.text && verse.verses) {
        // Already have both formats
        setVerseText(verse.text);
        setVerseKeyed(verse.verses);
      } else if (verse.text && !verse.verses) {
        // Have text but no keyed data - fetch to get keyed
        setVerseText(verse.text);
        setTextLoading(true);
        fetchVerseText(verse)
          .then(({ verses }) => setVerseKeyed(verses))
          .catch(() => {})
          .finally(() => setTextLoading(false));
      } else {
        // Need to fetch both
        setTextLoading(true);
        fetchVerseText(verse)
          .then(({ text, verses }) => {
            setVerseText(text);
            setVerseKeyed(verses);
          })
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
      ? 'This will clear all scores and review progress, and remove this verse from your Mastered list.'
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
      const text = verseKeyed[verse.verseStart.toString()] || verseText;
      return `${toSuperscript(verse.verseStart)}${text}`;
    }

    // Multi-verse: use keyed data if available
    const hasKeyedData = Object.keys(verseKeyed).length > 0;

    const parts: string[] = [];
    for (let i = 0; i < total; i++) {
      const verseNum = verse.verseStart + i;
      const text = hasKeyedData
        ? verseKeyed[verseNum.toString()] || ''
        : extractVerseText(verseText, i, total); // Fallback to deprecated splitting
      if (text) {
        parts.push(`${toSuperscript(verseNum)}${text}`);
      }
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
        {/* Top section - fixed content */}
        <View style={styles.topSection}>
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
              <Text style={[styles.previewText, { color: colors.text }]} numberOfLines={versePreviewLines}>
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
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Difficulty</Text>
            <View style={[styles.segmentedControl, { backgroundColor: colors.cardAlt }]}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((level) => (
                <Pressable
                  key={level}
                  style={[
                    styles.segment,
                    difficulty === level && { backgroundColor: 'rgba(176, 141, 87, 0.9)' },
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
                      <View style={[styles.difficultyDot, { backgroundColor: '#a5a5a5ff'}]} />
                    )}
                    {level === 'medium' && (
                      <View style={[styles.difficultyDot, { backgroundColor: '#1d4ed8'}]} />
                    )}
                    {level === 'hard' && (
                      <IconSymbol name="checkmark" size={12} color={colors.success} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.segmentSubtext,
                      { color: difficulty === level ? 'rgba(255,255,255,0.7)' : colors.icon },
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

          {/* Progress Card */}
          <ProgressCard progress={verse.progress} />

          {/* Chunk Size Selection - only show if multiple verses */}
          {totalVerses > 1 && (
            <View style={styles.chunkRow}>
              <Text style={[styles.chunkLabel, { color: colors.text }]}>Verses per chunk</Text>
              <DropDownPicker
                open={dropdownOpen}
                value={chunkSize}
                items={dropdownItems}
                setOpen={setDropdownOpen}
                setValue={setChunkSize}
                setItems={setDropdownItems}
                style={[styles.dropdown, { backgroundColor: colors.cardAlt, borderWidth: 0 }]}
                dropDownContainerStyle={[styles.dropdownContainer, { backgroundColor: colors.cardAlt, borderWidth: 0, maxHeight: 140 }]}
                textStyle={{ color: colors.text, fontSize: 16, fontWeight: '600' }}
                arrowIconStyle={{ tintColor: colors.icon } as any}
                tickIconStyle={{ tintColor: colors.text } as any}
                listItemLabelStyle={{ color: colors.text }}
                selectedItemContainerStyle={{ backgroundColor: colors.border }}
                containerStyle={{ width: 78, zIndex: 1000 }}
                showTickIcon={false}
              />
              {/* "All" shortcut — saves the user from scrolling the
                  dropdown to the largest value when they want to
                  practice the whole passage as one chunk. We don't
                  call setDropdownOpen(false) here; an external value
                  change while the picker is mid-open-animation
                  causes a one-frame label flash in
                  react-native-dropdown-picker@5. The picker closes on
                  outside-tap anyway, and a tap on this Pressable
                  registers as outside. */}
              <Pressable
                onPress={() => setChunkSize(totalVerses)}
                style={[
                  styles.chunkAllButton,
                  {
                    backgroundColor: chunkSize === totalVerses ? colors.primary : colors.cardAlt,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chunkAllButtonText,
                    { color: chunkSize === totalVerses ? colors.white : colors.text },
                  ]}
                >
                  All
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Start Button - flex pushes to bottom */}
        <View style={styles.bottomSection}>
          <Pressable
            style={[styles.startButton, { backgroundColor: 'rgba(176, 141, 87, 0.9)' }]}
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
    justifyContent: 'space-between',
  },
  topSection: {
    flex: 1,
    gap: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCard: {
    padding: 16,
    borderRadius: 12,
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
  chunkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chunkLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  dropdown: {
    borderRadius: 10,
    minHeight: 34,
  },
  dropdownContainer: {
    borderRadius: 10,
  },
  chunkAllButton: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chunkAllButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  bottomSection: {
    paddingTop: 20,
    paddingBottom: 0,
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
