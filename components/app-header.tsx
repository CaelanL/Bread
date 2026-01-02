import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface RightButtonProps {
  label: string;
  icon?: string;
  onPress: () => void;
  variant?: 'filled' | 'text';
}

interface LeftButtonProps {
  icon: string;
  onPress: () => void;
}

interface AppHeaderProps {
  title?: string;
  showBack?: boolean;
  leftButton?: LeftButtonProps;
  rightButton?: RightButtonProps;
}

export function AppHeader({ title, showBack = true, leftButton, rightButton }: AppHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primaryColor = colors.primary;

  const handleBack = () => {
    router.back();
  };

  const renderLeftButton = () => {
    if (leftButton) {
      return (
        <Pressable style={styles.backButton} onPress={leftButton.onPress}>
          <IconSymbol name={leftButton.icon as any} size={18} color={colors.text} />
        </Pressable>
      );
    }
    if (showBack) {
      return (
        <Pressable style={styles.backButton} onPress={handleBack}>
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
        <Text
          style={[
            styles.rightButtonText,
            { color: isFilled ? colors.white : primaryColor },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.leftSection}>
        {renderLeftButton()}
      </View>

      <View style={styles.centerSection}>
        {title && (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>

      <View style={styles.rightSection}>{renderRightButton()}</View>
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
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backPlaceholder: {
    width: 38,
  },
  title: {
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
});
