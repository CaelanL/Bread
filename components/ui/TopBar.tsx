import { GlassButton } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RailContext, RailSlotContext, railMenuAnchor, useRailActions } from '@/components/ui/TabRail';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';
import { useIsFocused } from 'expo-router/react-navigation';
import { useContext, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const BAR_HEIGHT = 44;

/** The bar's full height (status bar included): a scroll view's top padding under it. */
export function useTopBarHeight() {
  return useSafeAreaInsets().top + BAR_HEIGHT;
}

/** Where a menu opened from the bar's actions appears: under the bar's right end, or beside the rail's actions when they live there. */
export function useMenuAnchor() {
  const insets = useSafeAreaInsets();
  const outer = useWindowClass() === 'outer';
  return useContext(RailContext) ? railMenuAnchor(outer, insets) : { top: insets.top + BAR_HEIGHT, right: 12 };
}

/** A screen's bar, floating over its scroll view with no surface: back on the left, icon actions on the right. The screen's title lives only in its content, except study setup's reference bubble in `center`. Where the tabs show the right-edge rail, the actions move to the rail's top slot while the screen is focused. */
export function TopBar({ onBack, backLabel = 'Back', center, children }: {
  onBack?: () => void;
  backLabel?: string;
  center?: ReactNode;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const railed = useContext(RailContext);
  const focused = useIsFocused();
  useRailActions(children, railed && focused);

  return (
    // Off the rail, the right inset keeps actions clear of a status bar running down the right edge (the Duo's outer display); 0 on an iPhone.
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top, paddingRight: railed ? 0 : insets.right }]}>
      <View pointerEvents="box-none" style={styles.row}>
        {center && <View pointerEvents="box-none" style={styles.center}>{center}</View>}
        {onBack && <TopBarButton icon="chevron.left" label={backLabel} onPress={onBack} />}
        <View style={styles.spacer} />
        <View style={styles.actions}>{!railed && children}</View>
      </View>
    </View>
  );
}

/** A screen's title in its content. `root` is a tab's first screen (34/700), otherwise a pushed page (28/600). */
export function LargeTitle({ title, subtitle, root }: {
  title: string;
  subtitle?: string;
  root?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.large}>
      <Text accessibilityRole="header" style={[root ? styles.rootTitle : styles.pageTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.icon }]}>{subtitle}</Text>}
    </View>
  );
}

/** An icon button in the bar, in the text colour; a glass circle in the rail's top slot. */
export function TopBarButton({ icon, label, onPress, testID, disabled }: {
  icon: ComponentProps<typeof IconSymbol>['name'];
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  if (useContext(RailSlotContext)) {
    return <GlassButton icon={icon} label={label} onPress={onPress} testID={testID} disabled={disabled} />;
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <IconSymbol name={icon} size={icon === 'chevron.left' ? 22 : 20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  row: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  spacer: { flex: 1 },
  // Clear of a 44 pt button and the row's padding on each side.
  center: { ...StyleSheet.absoluteFill, left: 56, right: 56, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  large: { gap: 2 },
  rootTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.4 },
  pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 20 },
});
