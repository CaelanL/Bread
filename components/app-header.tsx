import { HeaderPill } from '@/components/library/CollectionHeader';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BAR_HEIGHT, TopBarButton } from '@/components/ui/TopBar';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/**
 * A fixed bar for screens that don't scroll under one: `TopBar`'s look, in the layout flow. The
 * title sits beside the back button, never centered. A labelled right action is a pill; an
 * icon-only one is a bar button.
 */
export function AppHeader({ title, leftButton, rightButton }: {
  title?: string;
  leftButton?: { icon: IconName; label?: string; onPress: () => void };
  rightButton?: { label?: string; icon?: IconName; onPress: () => void; accessibilityLabel?: string; disabled?: boolean; testID?: string };
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const left = leftButton ?? { icon: 'chevron.left' as const, label: 'Back', onPress: () => router.back() };

  return (
    <View style={[styles.bar, { marginTop: insets.top, backgroundColor: colors.background }]}>
      <TopBarButton icon={left.icon} label={left.label ?? 'Back'} onPress={left.onPress} />
      <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
      {rightButton && (rightButton.label ? (
        <View style={styles.pill}>
          <HeaderPill
            icon={rightButton.icon ?? 'book.closed'}
            label={rightButton.label}
            accessibilityLabel={rightButton.accessibilityLabel}
            testID={rightButton.testID}
            disabled={rightButton.disabled}
            onPress={rightButton.onPress}
          />
        </View>
      ) : (
        <TopBarButton
          icon={rightButton.icon ?? 'ellipsis'}
          label={rightButton.accessibilityLabel ?? 'More'}
          testID={rightButton.testID}
          disabled={rightButton.disabled}
          onPress={rightButton.onPress}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  title: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  pill: { marginRight: 10 },
});
