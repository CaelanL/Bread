import { showErrorToast } from '@/lib/toast';
import { BAR_HEIGHT, TopBar, TopBarButton, useTopBarHeight } from '@/components/ui/TopBar';
import { ChunkRow } from '@/components/study/setup/ChunkRow';
import { ChunkSizeModal } from '@/components/study/setup/ChunkSizeModal';
import { DifficultySwitcher, type Difficulty } from '@/components/study/setup/DifficultySwitcher';
import { PassageCard, passageParts, type PassageOrigin } from '@/components/study/setup/PassageCard';
import { ProgressCard } from '@/components/study/setup/ProgressCard';
import { ReferenceBubble } from '@/components/study/setup/ReferenceBubble';
import { StartButton } from '@/components/study/setup/StartButton';
import { VersePreview } from '@/components/study/setup/VersePreview';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getVerseText as fetchVerseText } from '@/lib/api/bible';
import { formatVerseReference } from '@/lib/storage';
import { useAppStore, useVerse } from '@/lib/store';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

// Screen height thresholds for verse preview lines
// Pro Max (956pts) > 920 → 4 lines, 16 Pro (874pts) > 870 → 3 lines, else → 2 lines
const LARGE_SCREEN_THRESHOLD = 920;
const MEDIUM_SCREEN_THRESHOLD = 870;

// Docked Start height. Used to reserve scroll padding so content can
// scroll fully past it without being hidden under it.
const START_BUTTON_HEIGHT = 56;

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

  // Detect screen size and set verse preview lines accordingly.
  // Use safe-area frame (excludes Dynamic Island / notch) so
  // breakpoint comparisons reflect usable height across iPhone
  // models, not raw window height.
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  // With verses hidden, the text shows only in the expanded view.
  const hideVerseText = useAppStore((state) => state.hideVerseText);
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
  const [passageOrigin, setPassageOrigin] = useState<PassageOrigin | null>(null);
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
    // Keyed on the verse *reference*, not the object: saving study
    // prefs swaps the verse's identity in the store, and re-running
    // this effect then flashes the text loader over already-loaded
    // text (visible as a flicker when starting a session).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verse?.id, verse?.version]);

  // Persist the setup whenever the user changes it, so prefs stick
  // even without starting a session. The store action no-ops when
  // values are unchanged.
  const savePrefs = (nextChunkSize: number, nextDifficulty: Difficulty) => {
    if (!id) return;
    useAppStore.getState().setVerseStudyPrefs(id, nextChunkSize, nextDifficulty);
  };

  const handleStartSession = () => {
    if (!verse || !id) return;
    savePrefs(chunkSize, difficulty);
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
        onPress: () => {
          resetVerseProgress(id).catch(() => showErrorToast("Couldn't reset progress. Try again."));
        },
      },
    ]);
  };

  if (!verse) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TopBar onBack={() => router.back()} />
        <View style={[styles.container, styles.centered]}>
          <Text style={{ color: colors.text }}>Verse not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar
        onBack={() => router.back()}
        center={<ReferenceBubble reference={formatVerseReference(verse)} onOpen={setPassageOrigin} />}
      >
        <TopBarButton icon="ellipsis" label="More" onPress={() => setMenuVisible(true)} />
      </TopBar>

      <PopoverMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        anchorPosition={{ top: insets.top + BAR_HEIGHT, right: 12 }}
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
          { paddingTop: barHeight + 12, paddingBottom: insets.bottom + START_BUTTON_HEIGHT + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <VersePreview
          text={verseText}
          loading={textLoading}
          hidden={hideVerseText}
          lines={versePreviewLines}
          onOpen={setPassageOrigin}
        />
        <DifficultySwitcher
          value={difficulty}
          onChange={(level) => {
            setDifficulty(level);
            savePrefs(chunkSize, level);
          }}
        />
        <ProgressCard progress={verse.progress} />
        {totalVerses > 1 && (
          <ChunkRow
            chunkSize={chunkSize}
            totalVerses={totalVerses}
            onOpenPicker={() => setChunkModalOpen(true)}
            onAll={() => {
              setChunkSize(totalVerses);
              savePrefs(totalVerses, difficulty);
            }}
          />
        )}
      </ScrollView>

      {/* Content fades out under the docked Start. pointerEvents=none so the gradient never intercepts taps. */}
      <LinearGradient
        colors={[hexToRgba(colors.background, 0), colors.background]}
        style={[styles.fadeOverlay, { height: insets.bottom + 110 }]}
        pointerEvents="none"
      />

      <View style={[styles.startDock, { bottom: Math.max(insets.bottom - 8, 4) }]} pointerEvents="box-none">
        <StartButton onPress={handleStartSession} />
      </View>

      <ChunkSizeModal
        visible={chunkModalOpen}
        totalVerses={totalVerses}
        initialChunkSize={chunkSize}
        onSave={(size) => {
          setChunkSize(size);
          savePrefs(size, difficulty);
        }}
        onClose={() => setChunkModalOpen(false)}
      />

      {passageOrigin && (
        <PassageCard
          origin={passageOrigin}
          reference={formatVerseReference(verse)}
          parts={passageParts(verse, verseText, verseKeyed)}
          onClose={() => setPassageOrigin(null)}
        />
      )}
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
    gap: 24,
  },
  fadeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  startDock: {
    position: 'absolute',
    left: 20,
    right: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
