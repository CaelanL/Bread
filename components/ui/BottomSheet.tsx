import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A dimmed backdrop with a card pinned to the bottom. Tapping the backdrop closes. */
export function SheetLayout({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { bottom } = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Not an accessibility element, so the sheet's own fields and buttons stay reachable. */}
      <Pressable accessible={false} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: Math.max(bottom, 16) + 8 }]}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

/** SheetLayout in a native modal, for sheets opened from inside a screen. */
export function BottomSheet({ visible = true, onClose, children }: { visible?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <SheetLayout onClose={onClose}>{children}</SheetLayout>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    alignSelf: 'center',
    borderTopLeftRadius: Radius.huge,
    borderTopRightRadius: Radius.huge,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.xs,
    marginBottom: 14,
  },
});
