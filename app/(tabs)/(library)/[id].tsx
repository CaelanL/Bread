import { CollectionList, useBackToLibrary } from '@/components/library/CollectionList';
import { GLASS_EDGE, paneShift, StudySetupPane } from '@/components/study/setup/StudySetupPane';
import { GlassButton } from '@/components/ui/Glass';
import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

/** The verse list beside study setup on a wide window (the Final boards). */
const LIST_WIDTH = 340;

/**
 * One collection. On a phone (and the Duo's narrower windows), the verse list; a row opens study
 * setup. On a wide window, the list on the left and the selected verse's setup on the right; the
 * sidebar button slides the list out and the setup takes the width. The selection and whether the
 * list is hidden last while the screen is open, through folds and rotations.
 * Dev builds also take `collapsed=1` (list hidden) or `collapsed=<verse id>` (that verse, list hidden), so
 * screenshots can show a board's state without taps. One param: the dev sign-in link loses a second one.
 */
export default function CollectionScreen() {
  const { id, collapsed: startCollapsed } = useLocalSearchParams<{ id: string; collapsed?: string }>();
  const devCollapsed = __DEV__ ? startCollapsed : undefined;
  const wide = useWindowClass() === 'wide';
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const backToLibrary = useBackToLibrary();
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState(devCollapsed && devCollapsed !== '1' ? devCollapsed : undefined);
  const [collapsed, setCollapsed] = useState(devCollapsed !== undefined);
  const [settling, setSettling] = useState(false);
  const collapse = useSharedValue(collapsed ? 1 : 0);

  const toggleList = () => {
    const next = !collapsed;
    setCollapsed(next);
    setSettling(true);
    collapse.set(withTiming(next ? 1 : 0, { duration: Motion.paneMs, easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(setSettling, false);
    }));
  };

  const sidebar = useAnimatedStyle(() => ({
    transform: [{ translateX: -(LIST_WIDTH + 1) * paneShift(collapse.value, reduced) }],
    opacity: reduced ? interpolate(collapse.value, [0, 0.5], [1, 0], 'clamp') : 1,
  }));

  // One tree for phone and wide, so a fold or unfold keeps the list (scroll, search) mounted.
  const sized = wide && width > 0;
  const split = sized && selectedId !== undefined;
  const listHidden = split && collapsed && !settling;
  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {split && (
        <StudySetupPane
          key={selectedId}
          verseId={selectedId}
          width={width}
          listWidth={LIST_WIDTH}
          collapse={collapse}
          collapsed={collapsed}
          settling={settling}
          buttons={2}
        />
      )}
      <Animated.View
        pointerEvents={listHidden ? 'none' : 'auto'}
        accessibilityElementsHidden={listHidden}
        importantForAccessibility={listHidden ? 'no-hide-descendants' : 'auto'}
        style={[
          styles.list,
          split ? { width: LIST_WIDTH } : styles.fill,
          split && { borderRightColor: colors.border, borderRightWidth: StyleSheet.hairlineWidth },
          { backgroundColor: colors.background },
          wide && !sized && styles.unsized,
          split && sidebar,
        ]}
      >
        <CollectionList id={id} wide={sized ? { width: split ? LIST_WIDTH : width, selectedId, onSelect: setSelectedId } : undefined} />
      </Animated.View>
      {wide && (
        <View style={[styles.buttons, { top: insets.top + GLASS_EDGE }]}>
          <GlassButton icon="chevron.left" label="Back" onPress={backToLibrary} />
          {split && (
            <GlassButton
              testID="sidebar-toggle"
              icon="sidebar.left"
              label={collapsed ? 'Show verse list' : 'Hide verse list'}
              expanded={!collapsed}
              onPress={toggleList}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  fill: { right: 0 },
  unsized: { opacity: 0 },
  buttons: { position: 'absolute', left: GLASS_EDGE, flexDirection: 'row', gap: 8, zIndex: 3 },
});
