import { ChunkRow } from '@/components/study/setup/ChunkRow';
import { DifficultySwitcher } from '@/components/study/setup/DifficultySwitcher';
import type { PassageOrigin } from '@/components/study/setup/PassageCard';
import { ProgressCard } from '@/components/study/setup/ProgressCard';
import { StartButton } from '@/components/study/setup/StartButton';
import { VersePreview } from '@/components/study/setup/VersePreview';
import { Colors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudySetup } from '@/hooks/use-study-setup';
import { useAppStore } from '@/lib/store';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Docked Start height. Used to reserve scroll padding so content can
// scroll fully past it without being hidden under it.
const START_BUTTON_HEIGHT = 56;

/**
 * Study setup as one column, in the phone's order: the preview, Difficulty, Your Progress, Verses per
 * chunk, and Start docked at the bottom over a fade. The phone screen, and the setup pane beside a
 * collection's verse list on a wide window.
 */
export function SetupColumn({ setup, previewLines, paddingTop, side = 20, onOpenPassage, onOpenChunks, previewTextStyle, onScroll }: {
  setup: StudySetup;
  previewLines: number;
  paddingTop: number;
  /** Space on each side of the column and the docked Start. */
  side?: number;
  onOpenPassage: (origin: PassageOrigin) => void;
  onOpenChunks: () => void;
  /** Wide windows: hides the preview text while it travels, and follows the scroll that moves it. */
  previewTextStyle?: ComponentProps<typeof Animated.Text>['style'];
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  // With verses hidden, the text shows only in the expanded view.
  const hideVerseText = useAppStore((state) => state.hideVerseText);
  const { verse, verseText, textLoading, difficulty, chunkSize, totalVerses } = setup;
  if (!verse) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop, paddingHorizontal: side, paddingBottom: insets.bottom + START_BUTTON_HEIGHT + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={onScroll ? 16 : undefined}
      >
        <VersePreview
          text={verseText}
          loading={textLoading}
          hidden={hideVerseText}
          lines={previewLines}
          onOpen={onOpenPassage}
          textStyle={previewTextStyle}
        />
        <DifficultySwitcher value={difficulty} onChange={setup.pickDifficulty} />
        <ProgressCard progress={verse.progress} />
        {totalVerses > 1 && (
          <ChunkRow
            chunkSize={chunkSize}
            totalVerses={totalVerses}
            onOpenPicker={onOpenChunks}
            onAll={() => setup.pickChunkSize(totalVerses)}
          />
        )}
      </ScrollView>

      {/* Content fades out under the docked Start. pointerEvents=none so the gradient never intercepts taps.
          The transparent stop is the page colour at 0, since RN's 'transparent' fades through black. */}
      <LinearGradient
        colors={[withAlpha(colors.background, 0), colors.background]}
        style={[styles.fadeOverlay, { height: insets.bottom + 110 }]}
        pointerEvents="none"
      />

      <View style={[styles.startDock, { left: side, right: side, bottom: Math.max(insets.bottom - 8, 4) }]} pointerEvents="box-none">
        <StartButton onPress={setup.handleStartSession} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
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
  },
});
