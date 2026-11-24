import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/js-tabs';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { GlassPill } from '@/components/ui/Glass';
import { Colors, Radius, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** True inside the tabs while the right-edge rail shows: a `TopBar` then hands its actions to the rail. */
export const RailContext = createContext(false);
/** True for actions drawn in the rail's top slot: `TopBarButton` draws itself as a `GlassButton` there. */
export const RailSlotContext = createContext(false);

// Named like a hook so the React Compiler treats reading it as one.
const useRailSlot = create<{ node: ReactNode; owner: object | null }>(() => ({ node: null, owner: null }));

/** Shows `node` in the rail's top slot while the calling screen is focused. */
export function useRailActions(node: ReactNode, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const owner = {};
    useRailSlot.setState({ node, owner });
    return () => {
      if (useRailSlot.getState().owner === owner) useRailSlot.setState({ node: null, owner: null });
    };
  }, [node, active]);
}

// The system status bar runs down the right edge on the Duo's displays (time, then Wi-Fi). Measured on the
// simulator: it ends about 98 pt down on the open Duo on its side and 151 pt down on the outer display.
const STATUS_ROOM = { wide: 106, outer: 160 };
const RAIL = {
  wide: { width: 76, button: 50, pad: 5, gap: 4, icon: 24 },
  outer: { width: 72, button: 46, pad: 4, gap: 3, icon: 22 },
};
const RAIL_BOTTOM = 20;
const MENU_GAP = 8;
const PILL_BOTTOM = 24;
const PILL_FADE = 40;
const BADGE = 18;

function TabButtons({ state, descriptors, emitter, navigateToTab, size, iconSize, labelled }: BottomTabBarProps & {
  size: { width: number; height: number };
  iconSize: number;
  labelled?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const focused = index === state.index;
    const color = focused ? colors.tint : colors.icon;
    const title = options.title ?? route.name;
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };
    return (
      <Pressable
        key={route.key}
        testID={options.tabBarButtonTestID}
        accessibilityRole="button"
        accessibilityLabel={`${title}, tab, ${index + 1} of ${state.routes.length}`}
        accessibilityState={{ selected: focused }}
        onPressIn={() => {
          if (process.env.EXPO_OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        onPress={onPress}
        style={[styles.tab, size, focused && { backgroundColor: colors.primaryLight }]}
      >
        {options.tabBarIcon?.({ focused, color, size: iconSize })}
        {labelled && <Text style={[styles.label, { color }, focused && styles.labelFocused]}>{title}</Text>}
        {options.tabBarBadge !== undefined && (
          <View style={[styles.badge, { backgroundColor: colors.error }]}>
            <Text style={[styles.badgeText, { color: colors.white }]}>{options.tabBarBadge}</Text>
          </View>
        )}
      </Pressable>
    );
  });
}

/** The rail's width and where its actions start, from the window's safe area. */
export function railFrame(compact: boolean, insets: EdgeInsets) {
  return {
    width: Math.max(RAIL[compact ? 'outer' : 'wide'].width, insets.right),
    actionsTop: Math.max(STATUS_ROOM[compact ? 'outer' : 'wide'], insets.top),
  };
}

/** A `PopoverMenu` anchor beside the rail's actions: level with the first one, just left of the rail. */
export function railMenuAnchor(compact: boolean, insets: EdgeInsets) {
  const { width, actionsTop } = railFrame(compact, insets);
  return { top: actionsTop, right: width + MENU_GAP };
}

/** The right-edge rail on wide windows and the Duo's outer display: the screen's actions on top, a vertical glass tab pill low. */
export function TabRail({ compact, ...props }: BottomTabBarProps & { compact: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const actions = useRailSlot((s) => s.node);
  const rail = RAIL[compact ? 'outer' : 'wide'];
  const { width, actionsTop } = railFrame(compact, props.insets);
  return (
    <View style={[styles.rail, { width, paddingTop: actionsTop, backgroundColor: colors.background }]}>
      <RailSlotContext.Provider value>
        <View style={styles.actions}>{actions}</View>
      </RailSlotContext.Provider>
      <GlassPill style={[styles.column, { padding: rail.pad, paddingHorizontal: rail.pad, gap: rail.gap }]}>
        <TabButtons {...props} size={{ width: rail.button, height: rail.button }} iconSize={rail.icon} />
      </GlassPill>
    </View>
  );
}

/** The open Duo upright: a floating glass tab pill at the bottom, the page fading out above it. */
export function TabPill(props: BottomTabBarProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const onHeight = useContext(BottomTabBarHeightCallbackContext);
  return (
    <View
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[styles.pillBar, { backgroundColor: colors.background }]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(colors.background, 0), colors.background]}
        style={styles.fade}
      />
      <GlassPill style={styles.pill}>
        <TabButtons {...props} size={{ width: 96, height: 54 }} iconSize={24} labelled />
      </GlassPill>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { alignItems: 'center', justifyContent: 'space-between', paddingBottom: RAIL_BOTTOM },
  actions: { alignItems: 'center', gap: 10 },
  column: { flexDirection: 'column' },
  tab: { borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '500' },
  labelFocused: { fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: BADGE,
    height: BADGE,
    borderRadius: Radius.full,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  pillBar: { alignItems: 'center', paddingTop: 8, paddingBottom: PILL_BOTTOM },
  fade: { position: 'absolute', top: -PILL_FADE, left: 0, right: 0, height: PILL_FADE },
  pill: { gap: 4, padding: 5, paddingHorizontal: 5 },
});
