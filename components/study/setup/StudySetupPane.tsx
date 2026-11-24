import { ChunkRow } from '@/components/study/setup/ChunkRow';
import { ChunkSizeModal } from '@/components/study/setup/ChunkSizeModal';
import { DifficultySwitcher } from '@/components/study/setup/DifficultySwitcher';
import { measureOrigin, PassageCard, passageParts, type PassageOrigin } from '@/components/study/setup/PassageCard';
import { ProgressCard } from '@/components/study/setup/ProgressCard';
import { ReferenceBubble } from '@/components/study/setup/ReferenceBubble';
import { Collapse, linear, listShift } from '@/components/study/setup/collapse-motion';
import { SetupColumn } from '@/components/study/setup/SetupColumn';
import { StartButton } from '@/components/study/setup/StartButton';
import { PREVIEW_INSET, PREVIEW_TEXT } from '@/components/study/setup/VersePreview';
import { HiddenBars, VerseTravel, type VerseFrame } from '@/components/study/setup/VerseTravel';
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
import { useContext, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewInstance } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

const paneEase = Easing.bezierFn(...Motion.easing);

/**
 * How far a sidebar has moved at progress `t` (linear in time: 0 it shows, 1 it's hidden), on Bread's
 * curve. Under Reduce Motion it jumps halfway, while both layouts are faded out. The study session's
 * chunk sidebar; a collection's list follows the `Collapse` knobs instead.
 */
export function paneShift(t: number, reduced: boolean) {
  'worklet';
  if (reduced) return t < 0.5 ? 0 : 1;
  return paneEase(t);
}

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
    const left = listWidth * (1 - listShift(collapse.value, reduced));
    return { left, width: width - left };
  });
  const sideFade = useAnimatedStyle(() => ({
    opacity: 1 - linear(collapse.value, Collapse.setupFadeOut),
  }));
  const wideFade = useAnimatedStyle(() => {
    const opacity = linear(collapse.value, Collapse.paneFadeIn);
    return { opacity, transform: [{ translateY: reduced ? 0 : Collapse.paneRise * (1 - opacity) }] };
  });
  const bubble = useAnimatedStyle(() => {
    const shift = listShift(collapse.value, reduced);
    const centre = openCentre + (shutCentre - openCentre) * shift;
    const box = openBox + (shutBox - openBox) * shift;
    return { left: centre - box / 2, width: box, opacity: reduced ? Math.abs(collapse.value - 0.5) * 2 : 1 };
  });
  return { pane, sideFade, wideFade, bubble };
}

/** Where pane A's verse sits and how much of it fits: very long passages are cut (⤢ and a tap show the rest). */
function paneVerse(text: string, verseWidth: number, height: number, insets: EdgeInsets) {
  const top = insets.top + CONTENT_TOP;
  const room = height - top - Math.max(BOTTOM, insets.bottom);
  const lineWidth = verseWidth - PANE_PAD * 2;
  const size = verseFontSize(text);
  return {
    top,
    lineWidth,
    size,
    lines: Math.max(1, Math.floor(room / size.lineHeight)),
    bars: hiddenLineWidths(text.length, lineWidth, size.fontSize)
      .slice(0, Math.max(1, Math.floor((room - SHOW_BUTTON_ROOM) / size.lineHeight))),
  };
}
type PaneVerse = ReturnType<typeof paneVerse>;

/**
 * Study setup on a wide window, for one verse. With the verse list showing (`listWidth`), the setup
 * column sits beside it; with the list hidden, or no list at all, the verse fills a tinted pane on
 * the left, sized by its length, and Your Progress, Difficulty, Verses per chunk and Start stand in
 * a column on the right. `collapse` moves between the two: the pane widens on the slide's curve, the
 * open layout fades out early and the wide one fades in once the width settles, while the preview's
 * text travels and grows into the pane's verse (`VerseTravel`). The reference bubble glides from the
 * centre of the setup column to the centre of the verse pane. Reset Progress is the ⋯ in the rail.
 */
export function StudySetupPane({ verseId, width, listWidth, collapse, collapsed, settling, buttons }: {
  verseId: string;
  /** The screen's width beside the rail. */
  width: number;
  /** The verse list's width while it shows; 0 when the screen has no list. */
  listWidth: number;
  /** 0 while the list shows, 1 once it's hidden, linear over `Collapse.durationMs`. */
  collapse: SharedValue<number>;
  /** Where `collapse` is heading. */
  collapsed: boolean;
  /** The list is sliding, so both layouts are drawn. */
  settling: boolean;
  /** Glass buttons at the top left (back, and the sidebar button when there's a list). */
  buttons: number;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const setup = useStudySetup(verseId);
  const hidden = useAppStore((state) => state.hideVerseText);
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

  // The verse travels between the preview and the pane while the list slides; the real texts hide
  // in flight. Not under Reduce Motion (the layouts fade) or while the text loads (a spinner).
  const travels = listWidth > 0 && !reduced && (hidden || (!setup.textLoading && setup.verseText !== ''));
  const sideShown = listWidth > 0 && (!collapsed || settling);
  const scrollY = useSharedValue(0);
  useEffect(() => {
    // The column comes back unscrolled.
    if (!sideShown) scrollY.set(0);
  }, [sideShown, scrollY]);
  const previewRest = useAnimatedStyle(() => ({ opacity: travels && collapse.value > 0 ? 0 : 1 }));
  const paneRest = useAnimatedStyle(() => ({ opacity: travels && collapse.value < 1 ? 0 : 1 }));

  const { verse } = setup;
  if (!verse) return null;
  const reference = formatVerseReference(verse);
  const verseLayout = paneVerse(setup.verseText, verseWidth, height, insets);
  const from: VerseFrame = {
    x: listWidth + SIDE + PREVIEW_INSET.left,
    y: insets.top + SIDE_TOP + PREVIEW_INSET.top,
    width: setupWidth - SIDE * 2 - PREVIEW_INSET.left - PREVIEW_INSET.right,
    ...PREVIEW_TEXT,
    lines: LIST_OPEN_PREVIEW_LINES,
  };
  const to: VerseFrame = { x: PANE_PAD, y: verseLayout.top, width: verseLayout.lineWidth, ...verseLayout.size, lines: verseLayout.lines };

  return (
    <>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View style={[styles.pane, pane]}>
          {sideShown && (
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
                previewTextStyle={previewRest}
                onScroll={(e) => scrollY.set(e.nativeEvent.contentOffset.y)}
              />
            </Animated.View>
          )}
          {(collapsed || settling) && (
            <Animated.View style={[styles.layer, { width }, wideFade]} pointerEvents={collapsed ? 'auto' : 'none'}>
              <SplitSetup
                setup={setup}
                verseWidth={verseWidth}
                verseLayout={verseLayout}
                verseStyle={paneRest}
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
      {/* A sibling of the verse list, above it, so the travelling verse is never under the list. */}
      {travels && (
        <VerseTravel
          collapse={collapse}
          scrollY={scrollY}
          from={from}
          to={to}
          text={setup.verseText}
          hidden={hidden}
          bars={verseLayout.bars}
        />
      )}
    </>
  );
}

/** The list hidden: the verse in a tinted pane on the left, the controls in a column on the right. */
function SplitSetup({ setup, verseWidth, verseLayout, verseStyle, onOpenPassage, onOpenChunks }: {
  setup: StudySetup;
  verseWidth: number;
  verseLayout: PaneVerse;
  /** Hides the verse while a copy of it travels. */
  verseStyle: ComponentProps<typeof Animated.View>['style'];
  onOpenPassage: (origin: PassageOrigin) => void;
  onOpenChunks: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const hidden = useAppStore((state) => state.hideVerseText);
  const expandRef = useRef<ViewInstance>(null);
  const textRef = useRef<ViewInstance>(null);
  const showRef = useRef<ViewInstance>(null);
  const { verse, verseText, textLoading, difficulty, chunkSize, totalVerses } = setup;
  if (!verse) return null;
  const { top, lineWidth, size, lines, bars } = verseLayout;

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

      <View style={[styles.verse, { top, bottom: Math.max(BOTTOM, insets.bottom), left: PANE_PAD, width: lineWidth }]}>
        {textLoading && !hidden ? (
          <ActivityIndicator size="small" color={colors.icon} style={styles.loader} />
        ) : hidden ? (
          <>
            <HiddenBars widths={bars} fontSize={size.fontSize} lineHeight={size.lineHeight} style={verseStyle} />
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
            <Animated.Text style={[size, { color: colors.text }, verseStyle]} numberOfLines={lines}>{verseText}</Animated.Text>
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
