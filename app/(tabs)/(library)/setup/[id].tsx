import { TopBar, TopBarButton, useMenuAnchor, useTopBarHeight } from '@/components/ui/TopBar';
import { ChunkSizeModal } from '@/components/study/setup/ChunkSizeModal';
import { PassageCard, passageParts, type PassageOrigin } from '@/components/study/setup/PassageCard';
import { ReferenceBubble } from '@/components/study/setup/ReferenceBubble';
import { SetupColumn } from '@/components/study/setup/SetupColumn';
import { GLASS_EDGE, StudySetupPane } from '@/components/study/setup/StudySetupPane';
import { GlassButton } from '@/components/ui/Glass';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useStudySetup } from '@/hooks/use-study-setup';
import { useWindowClass } from '@/hooks/use-window-class';
import { formatVerseReference } from '@/lib/storage';
import { useVerse } from '@/lib/store';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

// Screen height thresholds for verse preview lines
// Pro Max (956pts) > 920 → 4 lines, 16 Pro (874pts) > 870 → 3 lines, else → 2 lines
const LARGE_SCREEN_THRESHOLD = 920;
const MEDIUM_SCREEN_THRESHOLD = 870;

export default function StudySetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const verse = useVerse(id || '');
  const wide = useWindowClass() === 'wide';
  // Pushed from a collection (a phone row tap), an unfold goes back to it: the collection already has
  // this verse selected and shows its setup beside the list. Not while a session is open over setup.
  const focused = useIsFocused();
  const state = useNavigation().getState();
  const fromCollection = state?.routes[state.index - 1]?.name === '[id]';
  const toCollection = wide && focused && fromCollection;
  useEffect(() => {
    if (toCollection) router.back();
  }, [toCollection]);

  if (toCollection) return null;
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
  return wide ? <WideSetup id={verse.id} /> : <PhoneSetup id={verse.id} />;
}

function PhoneSetup({ id }: { id: string }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const setup = useStudySetup(id);
  const barHeight = useTopBarHeight();
  const menuAnchor = useMenuAnchor();
  // Detect screen size and set verse preview lines accordingly.
  // Use safe-area frame (excludes Dynamic Island / notch) so
  // breakpoint comparisons reflect usable height across iPhone
  // models, not raw window height.
  const frameHeight = useSafeAreaFrame().height;
  const versePreviewLines = frameHeight > LARGE_SCREEN_THRESHOLD ? 4
    : frameHeight > MEDIUM_SCREEN_THRESHOLD ? 3
    : 2;
  const [chunkModalOpen, setChunkModalOpen] = useState(false);
  const [passageOrigin, setPassageOrigin] = useState<PassageOrigin | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const { verse } = setup;
  if (!verse) return null;

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
        anchorPosition={menuAnchor}
        items={[
          {
            label: 'Reset Progress',
            icon: 'arrow.counterclockwise',
            onPress: setup.handleResetProgress,
            destructive: true,
          },
        ]}
      />

      <SetupColumn
        setup={setup}
        previewLines={versePreviewLines}
        paddingTop={barHeight + 12}
        onOpenPassage={setPassageOrigin}
        onOpenChunks={() => setChunkModalOpen(true)}
      />

      <ChunkSizeModal
        visible={chunkModalOpen}
        totalVerses={setup.totalVerses}
        initialChunkSize={setup.chunkSize}
        onSave={setup.pickChunkSize}
        onClose={() => setChunkModalOpen(false)}
      />

      {passageOrigin && (
        <PassageCard
          origin={passageOrigin}
          reference={formatVerseReference(verse)}
          parts={passageParts(verse, setup.verseText, setup.verseKeyed)}
          onClose={() => setPassageOrigin(null)}
        />
      )}
    </View>
  );
}

/** Opened straight to setup on a wide window (a link): the list-hidden layout, with no list to show. */
function WideSetup({ id }: { id: string }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const listHidden = useSharedValue(1);
  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <StudySetupPane verseId={id} width={width} listWidth={0} collapse={listHidden} collapsed settling={false} buttons={1} />
      )}
      <View style={[styles.back, { top: insets.top + GLASS_EDGE }]}>
        <GlassButton icon="chevron.left" label="Back" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  back: {
    position: 'absolute',
    left: GLASS_EDGE,
    zIndex: 3,
  },
});
