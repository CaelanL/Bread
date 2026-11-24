import { ChunkRow } from '@/components/study/setup/ChunkRow';
import { ChunkSizeModal } from '@/components/study/setup/ChunkSizeModal';
import { DifficultySwitcher } from '@/components/study/setup/DifficultySwitcher';
import { measureOrigin, PassageCard, passageParts, type PassageOrigin } from '@/components/study/setup/PassageCard';
import { ProgressCard } from '@/components/study/setup/ProgressCard';
import { ReferenceBubble } from '@/components/study/setup/ReferenceBubble';
import { SetupColumn } from '@/components/study/setup/SetupColumn';
import { StartButton } from '@/components/study/setup/StartButton';
import { GlassButton } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { RailContext, useRailActions } from '@/components/ui/TabRail';
import { TopBarButton, useMenuAnchor } from '@/components/ui/TopBar';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useStudySetup, type StudySetup } from '@/hooks/use-study-setup';
import { hiddenLineWidths, verseFontSize } from '@/lib/layout';
import { useAppStore } from '@/lib/store';
import { formatVerseReference } from '@/lib/storage';
import { useIsFocused } from 'expo-router/react-navigation';
import { useContext, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewInstance } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const paneEase = Easing.bezierFn(...Motion.easing);

/**
 * How far the panes have moved at collapse progress `t` (linear in time: 0 the verse list shows, 1
 * it's hidden), on Bread's curve. Under Reduce Motion they jump halfway, while both layouts are faded out.
 */
export function paneShift(t: number, reduced: boolean) {
  'worklet';
  if (reduced) return t < 0.5 ? 0 : 1;
  return paneEase(t);
}

// The Final boards' fades inside the slide: the list-open layout fades out over its first 120 ms, the
// wide layout fades in (rising 8 pt) from 200 ms, once the width has nearly settled.
const SIDE_FADE_END = 120 / Motion.paneMs;
const WIDE_FADE_START = 200 / Motion.paneMs;
const WIDE_RISE = 8;

/** The tinted verse pane's share of the width with the list hidden (444 of 875 on the boards). */
const VERSE_PANE_SHARE = 0.51;
/** The glass buttons: inset from the top and left, size and gap. */
export const GLASS_EDGE = 16;
const BUTTON = 44;
const BUTTON_GAP = 8;
/** Where content starts under the buttons, the side padding and the bottom margin (the boards). */
export const CONTENT_TOP = 84;
export const SIDE_TOP = 76;
export const SIDE = 32;
export const PANE_PAD = 40;
const BOTTOM = 32;
const BUBBLE_MAX = 300;
const SHOW_BUTTON_ROOM = 28 + 44;
const LIST_OPEN_PREVIEW_LINES = 3;

/**
 * The right pane's motion on a wide window, shared by study setup and a shared collection's Details:
 * the pane's left edge follows the list out on Bread's curve, the list-open layout fades out early
 * (`sideFade`), the list-hidden one fades in once the width settles (`wideFade`), and the title bubble
 * glides from the centre of the pane beside the list to `shutCentre`, narrowed to clear the buttons.
 */
export function usePaneMotion({ collapse, width, listWidth, buttons, shutCentre }: {
  collapse: SharedValue<number>;
  width: number;
  listWidth: number;
  /** Glass buttons at the top left. */
  buttons: number;
  /** The bubble's centre with the list hidden. */
  shutCentre: number;
}) {
  const reduced = useReducedMotion();
  const setupWidth = width - listWidth;
  const buttonsEnd = GLASS_EDGE + buttons * (BUTTON + BUTTON_GAP);
  const openCentre = listWidth + setupWidth / 2;
  const openBox = Math.min(BUBBLE_MAX, setupWidth - 2 * GLASS_EDGE);
  const shutBox = Math.min(BUBBLE_MAX, 2 * (shutCentre - buttonsEnd));

  const pane = useAnimatedStyle(() => {
    const left = listWidth * (1 - paneShift(collapse.value, reduced));
    return { left, width: width - left };
  });
  const sideFade = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0, SIDE_FADE_END], [1, 0], 'clamp'),
  }));
  const wideFade = useAnimatedStyle(() => {
    const opacity = interpolate(collapse.value, [WIDE_FADE_START, 1], [0, 1], 'clamp');
    return { opacity, transform: [{ translateY: reduced ? 0 : WIDE_RISE * (1 - opacity) }] };
  });
  const bubble = useAnimatedStyle(() => {
    const shift = paneShift(collapse.value, reduced);
    const centre = openCentre + (shutCentre - openCentre) * shift;
    const box = openBox + (shutBox - openBox) * shift;
    return { left: centre - box / 2, width: box, opacity: reduced ? Math.abs(collapse.value - 0.5) * 2 : 1 };
  });
  return { pane, sideFade, wideFade, bubble };
}

/**
 * Study setup on a wide window, for one verse. With the verse list showing (`listWidth`), the setup
 * column sits beside it; with the list hidden, or no list at all, the verse fills a tinted pane on
 * the left, sized by its length, and Your Progress, Difficulty, Verses per chunk and Start stand in
 * a column on the right. `collapse` moves between the two: the pane widens on the slide's curve, the
 * open layout fades out early and the wide one fades in once the width settles. The reference bubble
 * glides from the centre of the setup column to the centre of the verse pane. Reset Progress is the
 * ⋯ in the rail.
 */
export function StudySetupPane({ verseId, width, listWidth, collapse, collapsed, settling, buttons }: {
  verseId: string;
  /** The screen's width beside the rail. */
  width: number;
  /** The verse list's width while it shows; 0 when the screen has no list. */
  listWidth: number;
  /** 0 while the list shows, 1 once it's hidden, linear over `Motion.paneMs`. */
  collapse: SharedValue<number>;
  /** Where `collapse` is heading. */
  collapsed: boolean;
  /** The list is sliding, so both layouts are drawn. */
  settling: boolean;
  /** Glass buttons at the top left (back, and the sidebar button when there's a list). */
  buttons: number;
}) {
  const insets = useSafeAreaInsets();
  const setup = useStudySetup(verseId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chunksOpen, setChunksOpen] = useState(false);
  const [passageOrigin, setPassageOrigin] = useState<PassageOrigin | null>(null);
  const menuAnchor = useMenuAnchor();
  const railed = useContext(RailContext);
  const focused = useIsFocused();
  useRailActions(<TopBarButton icon="ellipsis" label="Verse options" onPress={() => setMenuOpen(true)} />, railed && focused);

  const verseWidth = Math.round(width * VERSE_PANE_SHARE);
  const setupWidth = width - listWidth;
  const { pane, sideFade, wideFade, bubble } = usePaneMotion({ collapse, width, listWidth, buttons, shutCentre: verseWidth / 2 });

  const { verse } = setup;
  if (!verse) return null;
  const reference = formatVerseReference(verse);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.pane, pane]}>
        {listWidth > 0 && (!collapsed || settling) && (
          <Animated.View
            style={[styles.layer, { width: setupWidth }, sideFade]}
            pointerEvents={collapsed ? 'none' : 'auto'}
          >
            <SetupColumn
              setup={setup}
              previewLines={LIST_OPEN_PREVIEW_LINES}
              paddingTop={insets.top + SIDE_TOP}
              side={SIDE}
              onOpenPassage={setPassageOrigin}
              onOpenChunks={() => setChunksOpen(true)}
            />
          </Animated.View>
        )}
        {(collapsed || settling) && (
          <Animated.View style={[styles.layer, { width }, wideFade]} pointerEvents={collapsed ? 'auto' : 'none'}>
            <SplitSetup
              setup={setup}
              verseWidth={verseWidth}
              onOpenPassage={setPassageOrigin}
              onOpenChunks={() => setChunksOpen(true)}
            />
          </Animated.View>
        )}
      </Animated.View>

      <Animated.View pointerEvents="box-none" style={[styles.bubble, { top: insets.top + GLASS_EDGE }, bubble]}>
        <ReferenceBubble reference={reference} onOpen={setPassageOrigin} />
      </Animated.View>

      <PopoverMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorPosition={menuAnchor}
        items={[{ label: 'Reset Progress', icon: 'arrow.counterclockwise', onPress: setup.handleResetProgress, destructive: true }]}
      />
      <ChunkSizeModal
        visible={chunksOpen}
        totalVerses={setup.totalVerses}
        initialChunkSize={setup.chunkSize}
        onSave={setup.pickChunkSize}
        onClose={() => setChunksOpen(false)}
      />
      {passageOrigin && (
        <PassageCard
          origin={passageOrigin}
          reference={reference}
          parts={passageParts(verse, setup.verseText, setup.verseKeyed)}
          onClose={() => setPassageOrigin(null)}
        />
      )}
    </View>
  );
}

/** The list hidden: the verse in a tinted pane on the left, the controls in a column on the right. */
function SplitSetup({ setup, verseWidth, onOpenPassage, onOpenChunks }: {
  setup: StudySetup;
  verseWidth: number;
  onOpenPassage: (origin: PassageOrigin) => void;
  onOpenChunks: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const hidden = useAppStore((state) => state.hideVerseText);
  const expandRef = useRef<ViewInstance>(null);
  const textRef = useRef<ViewInstance>(null);
  const showRef = useRef<ViewInstance>(null);
  const { verse, verseText, textLoading, difficulty, chunkSize, totalVerses } = setup;
  if (!verse) return null;

  const top = insets.top + CONTENT_TOP;
  const bottom = Math.max(BOTTOM, insets.bottom);
  const lineWidth = verseWidth - PANE_PAD * 2;
  const size = verseFontSize(verseText);
  // Very long passages are cut off here; ⤢ and a tap on the text show the rest.
  const lines = Math.max(1, Math.floor((height - top - bottom) / size.lineHeight));
  const barHeight = Math.round(size.fontSize * 0.6);
  const bars = hiddenLineWidths(verseText.length, lineWidth, size.fontSize)
    .slice(0, Math.max(1, Math.floor((height - top - bottom - SHOW_BUTTON_ROOM) / size.lineHeight)));

  return (
    <>
      <View style={[styles.versePane, { width: verseWidth, backgroundColor: colors.pane, borderRightColor: colors.paneBorder }]} />
      <View
        ref={expandRef}
        collapsable={false}
        style={[styles.expand, { top: insets.top + GLASS_EDGE, left: verseWidth - GLASS_EDGE - BUTTON }]}
      >
        <GlassButton
          testID="verse-expand"
          icon="arrow.up.left.and.arrow.down.right"
          label="Show the whole passage"
          onPress={() => measureOrigin(expandRef, onOpenPassage)}
        />
      </View>

      <View style={[styles.verse, { top, bottom, left: PANE_PAD, width: lineWidth }]}>
        {textLoading && !hidden ? (
          <ActivityIndicator size="small" color={colors.icon} style={styles.loader} />
        ) : hidden ? (
          <>
            <View style={[styles.bars, { gap: size.lineHeight - barHeight, paddingTop: Math.round((size.lineHeight - barHeight) / 2) }]}>
              {bars.map((percent, i) => (
                <View
                  key={i}
                  style={[styles.bar, { width: `${percent}%`, height: barHeight, backgroundColor: colors.primaryLight }]}
                />
              ))}
            </View>
            <Pressable
              ref={showRef}
              testID="show-verse"
              accessibilityRole="button"
              accessibilityHint="Shows the whole passage"
              onPress={() => measureOrigin(showRef, onOpenPassage)}
              style={({ pressed }) => [styles.show, { backgroundColor: colors.primaryLight }, pressed && styles.pressed]}
            >
              <IconSymbol name="eye" size={18} color={colors.tint} />
              <Text style={[styles.showText, { color: colors.tint }]}>Show verse</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            ref={textRef}
            testID="verse-preview"
            accessibilityRole="button"
            accessibilityHint="Shows the whole passage"
            onPress={() => measureOrigin(textRef, onOpenPassage)}
          >
            <Text style={[size, { color: colors.text }]} numberOfLines={lines}>{verseText}</Text>
          </Pressable>
        )}
      </View>

      {/* The sections scroll (larger text), Start stays docked under them. */}
      <View style={[styles.column, { left: verseWidth, paddingBottom: Math.max(insets.bottom, 24) }]}>
        <ScrollView
          style={styles.sections}
          contentContainerStyle={[styles.sectionsContent, { paddingTop: top }]}
          showsVerticalScrollIndicator={false}
        >
        <ProgressCard progress={verse.progress} />
        <View style={styles.difficulty}>
          <DifficultySwitcher value={difficulty} onChange={setup.pickDifficulty} />
        </View>
        {totalVerses > 1 && (
          <View style={styles.chunks}>
            <ChunkRow
              chunkSize={chunkSize}
              totalVerses={totalVerses}
              onOpenPicker={onOpenChunks}
              onAll={() => setup.pickChunkSize(totalVerses)}
            />
          </View>
        )}
        </ScrollView>
        <View style={styles.start}>
          <StartButton onPress={setup.handleStartSession} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  pane: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  layer: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  bubble: { position: 'absolute', alignItems: 'center', zIndex: 2 },
  versePane: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  expand: { position: 'absolute', zIndex: 1 },
  verse: { position: 'absolute', alignItems: 'flex-start' },
  loader: { marginTop: 4 },
  bars: { alignSelf: 'stretch' },
  bar: { borderRadius: Radius.full },
  show: {
    marginTop: 28,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  showText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  column: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  sections: { flex: 1 },
  sectionsContent: { paddingHorizontal: PANE_PAD, paddingBottom: 16 },
  start: { paddingHorizontal: PANE_PAD, paddingTop: 8 },
  difficulty: { marginTop: 24 },
  chunks: { marginTop: 20 },
});
