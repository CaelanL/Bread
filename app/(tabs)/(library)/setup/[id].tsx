import { AppHeader } from '@/components/app-header';
import { ChunkSizeModal } from '@/components/study/ChunkSizeModal';
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
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

type Difficulty = 'easy' | 'medium' | 'hard';

// Screen height thresholds for verse preview lines
// Pro Max (956pts) > 920 → 4 lines, 16 Pro (874pts) > 870 → 3 lines, else → 2 lines
const LARGE_SCREEN_THRESHOLD = 920;
const MEDIUM_SCREEN_THRESHOLD = 870;

// Floating pill height + breathing room. Used to reserve scroll
// padding so content can scroll fully past the pill without being
// hidden under it.
const START_BUTTON_HEIGHT = 42;

/** Convert a #rrggbb hex color to an `rgba()` string with the given
 * alpha. Used so the bottom fade-gradient's "transparent" stop
 * matches the page background's hue exactly (RN's `'transparent'`
 * keyword interpolates through black, which produces a visible gray
 * band on light themes). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function StudySetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Detect screen size and set verse preview lines accordingly.
  // Use safe-area frame (excludes Dynamic Island / notch) so
  // breakpoint comparisons reflect usable height across iPhone
  // models, not raw window height.
  const insets = useSafeAreaInsets();
  const frameHeight = useSafeAreaFrame().height;
  const versePreviewLines = frameHeight > LARGE_SCREEN_THRESHOLD ? 4
    : frameHeight > MEDIUM_SCREEN_THRESHOLD ? 3
    : 2;

  // Get verse from store (instant, no loading)
  const verse = useVerse(id || '');
  const resetVerseProgress = useAppStore((s) => s.resetVerseProgress);

  const [verseText, setVerseText] = useState<string>('');
  const [verseKeyed, setVerseKeyed] = useState<Record<string, string>>({});
  const [textLoading, setTextLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [chunkSize, setChunkSize] = useState(1);
  const [chunkModalOpen, setChunkModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Calculate total verses in this passage
  const totalVerses = verse ? verse.verseEnd - verse.verseStart + 1 : 1;

  // Restore the last setup the user chose for this verse (saved when
  // a session starts). A mastered verse with nothing saved yet (all
  // pre-migration-021 masteries) falls back to the review setup —
  // Hard, whole passage — because engraved reviews only qualify on
  // Hard; defaulting to Easy would silently stall the review loop.
  // Everything else falls back to easy / 1-verse chunks. Runs once
  // after the verse loads; the defaultsApplied gate keeps it from
  // fighting the user's choice on re-render. Saved chunk size is
  // clamped in case it exceeds this passage's verse count.
  useEffect(() => {
    if (!verse || defaultsApplied) return;
    const mastered = verse.progress?.hard?.completed === true;
    setDifficulty(verse.lastDifficulty ?? (mastered ? 'hard' : 'easy'));
    setChunkSize(
      verse.lastChunkSize != null
        ? Math.min(verse.lastChunkSize, totalVerses)
        : mastered ? totalVerses : 1,
    );
    setDefaultsApplied(true);
  }, [verse, defaultsApplied, totalVerses]);

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
    if (!verse || !id) return;
    useAppStore.getState().setVerseStudyPrefs(id, chunkSize, difficulty);
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + START_BUTTON_HEIGHT + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formColumn}>
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

          {/* Chunk Size Selection - only show if multiple verses.
              Tapping the value-pill opens ChunkSizeModal where the
              user picks 1..N or "All". Replaces the prior
              react-native-dropdown-picker — same data, new shell. */}
          {totalVerses > 1 && (
            <View style={styles.chunkRow}>
              <Text style={[styles.chunkLabel, { color: colors.text }]}>Verses per chunk</Text>
              <Pressable
                onPress={() => setChunkModalOpen(true)}
                style={[styles.chunkValueButton, { backgroundColor: colors.cardAlt }]}
              >
                <Text style={[styles.chunkValueText, { color: colors.text }]}>
                  {Math.min(chunkSize, totalVerses)}
                </Text>
                <IconSymbol name="chevron.right" size={14} color={colors.icon} />
              </Pressable>
              <Pressable
                onPress={() => setChunkSize(totalVerses)}
                style={[
                  styles.chunkAllButton,
                  {
                    backgroundColor: chunkSize >= totalVerses ? colors.primary : colors.cardAlt,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chunkAllButtonText,
                    { color: chunkSize >= totalVerses ? colors.white : colors.text },
                  ]}
                >
                  All
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Soft fade behind the pill. The gradient occupies the bottom
          ~140pt and goes from fully-transparent at the top to the
          screen background at the bottom. Effect: content scrolling
          behind the pill visibly fades out before reaching it, so
          the pill reads as hovering above (not colliding with) the
          form. iOS-conventional pattern (Maps, Music, App Store).
          pointerEvents=none so the gradient never intercepts taps. */}
      <LinearGradient
        colors={[hexToRgba(colors.background, 0), colors.background]}
        style={[styles.fadeOverlay, { height: insets.bottom + 110 }]}
        pointerEvents="none"
      />

      {/* Floating start pill — absolutely positioned so it always
          sits above the scroll content. ScrollView's contentInset
          reserves matching space at the bottom so the pill never
          covers the last form row. Anchored to safe-area-bottom +
          16, with a soft shadow to read as floating. */}
      <View style={[styles.floatingButtonWrap, { bottom: Math.max(insets.bottom - 8, 4) }]} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [
            styles.startPill,
            {
              backgroundColor: 'rgba(176, 141, 87, 0.95)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          onPress={handleStartSession}
        >
          <Text style={styles.startPillText}>Start session</Text>
          <IconSymbol name="arrow.right" size={18} color={colors.white} />
        </Pressable>
      </View>

      <ChunkSizeModal
        visible={chunkModalOpen}
        totalVerses={totalVerses}
        initialChunkSize={chunkSize}
        onSave={setChunkSize}
        onClose={() => setChunkModalOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    // paddingBottom is computed dynamically (insets + pill height)
    // via inline style on the ScrollView.
  },
  formColumn: {
    gap: 20,
  },
  fadeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingButtonWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  startPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 24,
    borderRadius: 21,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  startPillText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
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
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  difficultyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  segmentSubtext: {
    fontSize: 10,
    marginTop: 1,
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
  chunkValueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  chunkValueText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chunkAllButton: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chunkAllButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
