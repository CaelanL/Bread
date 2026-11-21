import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  Animated,
  useWindowDimensions,
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

// Space kept between the menu and the safe area's edges.
const EDGE_GAP = 8;

export function PopoverMenu({
  visible,
  onClose,
  items,
  anchorPosition = { top: 100, right: 16 },
}: PopoverMenuProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Measured on first layout; the menu stays hidden until then so it never shows cut off.
  const [menuHeight, setMenuHeight] = useState(0);
  const top = Math.max(
    insets.top + EDGE_GAP,
    Math.min(anchorPosition.top, windowHeight - insets.bottom - EDGE_GAP - menuHeight),
  );

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pendingAction = useRef<(() => void) | null>(null);
  const closing = useRef(false);

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

  const finishDismiss = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    closing.current = false;
    action?.();
  };

  const handleClose = (action?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    pendingAction.current = action ?? null;
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      onClose();
      if (Platform.OS !== 'ios') finishDismiss();
    });
  };

  const menuBg = isDark ? colors.cardAlt : colors.card;
  const separatorColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => handleClose()}
      onDismiss={finishDismiss}
    >
      <Pressable accessible={false} style={styles.overlay} onPress={() => handleClose()}>
        <Animated.View
          onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
          style={[
            styles.menu,
            {
              backgroundColor: menuBg,
              top,
              right: anchorPosition.right,
              opacity: menuHeight ? fadeAnim : 0,
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
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => handleClose(item.onPress)}
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
