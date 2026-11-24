import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const liquidGlass = isLiquidGlassAvailable();

/** Liquid Glass on iOS 26 and later; before it, a translucent fill with a hairline and a soft shadow. */
function GlassSurface({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const scheme = useColorScheme() ?? 'light';
  if (liquidGlass) {
    return <GlassView colorScheme={scheme} style={style}>{children}</GlassView>;
  }
  const colors = Colors[scheme];
  return (
    <View style={[style, styles.fallback, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      {children}
    </View>
  );
}

/** A 44 pt glass circle holding one icon: a wide window's back, sidebar and ⋯ buttons. */
export function GlassButton({ icon, label, onPress, testID, disabled, expanded }: {
  icon: ComponentProps<typeof IconSymbol>['name'];
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <GlassSurface style={styles.button}>
        <IconSymbol name={icon} size={icon === 'chevron.left' ? 22 : 20} color={colors.text} />
      </GlassSurface>
    </Pressable>
  );
}

/** A glass capsule: the reference bubble, the tab pill. Lays its children out in a row unless `style` says otherwise. */
export function GlassPill({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <GlassSurface style={[styles.pill, style]}>{children}</GlassSurface>;
}

const styles = StyleSheet.create({
  fallback: { borderWidth: 1, boxShadow: Shadows.glass },
  button: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: 44, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  pressed: { opacity: 0.5 },
});
