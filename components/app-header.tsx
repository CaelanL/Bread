import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface RightButtonProps {
  label?: string;
  icon?: string;
  onPress: () => void;
  variant?: 'filled' | 'text' | 'icon';
}

interface LeftButtonProps {
  icon: string;
  label?: string;
  onPress: () => void;
}

interface AppHeaderProps {
  title?: string;
  titleIcon?: {
    name: ComponentProps<typeof IconSymbol>['name'];
    label: string;
    onPress: () => void;
  };
  showBack?: boolean;
  leftButton?: LeftButtonProps;
  rightButton?: RightButtonProps;
}

export function AppHeader({ title, titleIcon, showBack = true, leftButton, rightButton }: AppHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const primaryColor = colors.primary;

  const handleBack = () => {
    router.back();
  };

  const renderLeftButton = () => {
    if (leftButton) {
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={leftButton.label} style={styles.backButton} onPress={leftButton.onPress}>
          <IconSymbol name={leftButton.icon as any} size={18} color={colors.text} />
        </Pressable>
      );
    }
    if (showBack) {
      return (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backButton} onPress={handleBack}>
          <IconSymbol name="chevron.left" size={22} color={primaryColor} />
        </Pressable>
      );
    }
    return <View style={styles.backPlaceholder} />;
  };

  const renderRightButton = () => {
    if (!rightButton) return <View style={styles.rightPlaceholder} />;

    const { label, icon, onPress, variant = 'filled' } = rightButton;
    const isFilled = variant === 'filled';
    const isIconOnly = variant === 'icon';

    if (isIconOnly && icon) {
      return (
        <Pressable style={styles.iconButton} onPress={onPress}>
          <IconSymbol name={icon as any} size={28} color={primaryColor} />
        </Pressable>
      );
    }

    return (
      <Pressable
        style={[
          styles.rightButton,
          isFilled && { backgroundColor: primaryColor },
        ]}
        onPress={onPress}
      >
        {icon && (
          <IconSymbol
            name={icon as any}
            size={18}
            color={isFilled ? colors.white : primaryColor}
          />
        )}
        {label && (
          <Text
            style={[
              styles.rightButtonText,
              { color: isFilled ? colors.white : primaryColor },
            ]}
          >
            {label}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.leftSection, titleIcon && styles.fixedSide]}>
        {renderLeftButton()}
      </View>

      <View style={[styles.centerSection, titleIcon && styles.centerWithIcon]}>
        {titleIcon && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={titleIcon.label}
            onPress={titleIcon.onPress}
            style={({ pressed }) => [styles.titleIcon, {
              backgroundColor: pressed ? colors.cardAlt : colors.primaryLight,
            }]}
          >
            <IconSymbol name={titleIcon.name} size={23} color={colors.text} />
          </Pressable>
        )}
        {title && (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>

      <View style={[styles.rightSection, titleIcon && styles.fixedSide]}>{renderRightButton()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
  },
  leftSection: {
    flex: 1,
    alignItems: 'flex-start',
  },
  centerSection: {
    flex: 2,
    alignItems: 'center',
  },
  rightSection: {
    flex: 1,
    alignItems: 'flex-end',
  },
  fixedSide: {
    width: 44,
    flex: 0,
  },
  centerWithIcon: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  titleIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backPlaceholder: {
    width: 38,
  },
  title: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  rightButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  rightButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  rightPlaceholder: {
    width: 60,
  },
  iconButton: {
    padding: 4,
  },
});
