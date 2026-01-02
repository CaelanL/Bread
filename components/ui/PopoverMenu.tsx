import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Animated,
  Dimensions,
} from 'react-native';

interface PopoverMenuItem {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

interface PopoverMenuProps {
  visible: boolean;
  onClose: () => void;
  items: PopoverMenuItem[];
  anchorPosition?: { top: number; right: number };
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function PopoverMenu({
  visible,
  onClose,
  items,
  anchorPosition = { top: 100, right: 16 },
}: PopoverMenuProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const menuBg = isDark ? colors.cardAlt : colors.card;
  const separatorColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Animated.View
          style={[
            styles.menu,
            {
              backgroundColor: menuBg,
              top: anchorPosition.top,
              right: anchorPosition.right,
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {items.map((item, index) => (
            <View key={item.label}>
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
                ]}
                onPress={() => {
                  handleClose();
                  // Small delay to let animation finish
                  setTimeout(item.onPress, 100);
                }}
              >
                {item.icon && (
                  <IconSymbol
                    name={item.icon as any}
                    size={18}
                    color={item.destructive ? colors.error : colors.text}
                  />
                )}
                <Text
                  style={[
                    styles.menuItemText,
                    { color: item.destructive ? colors.error : colors.text },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
              {index < items.length - 1 && (
                <View style={[styles.separator, { backgroundColor: separatorColor }]} />
              )}
            </View>
          ))}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    minWidth: 180,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '500',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
});
