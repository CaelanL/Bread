import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, InputText, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

/**
 * A card centered on a blurred, dimmed backdrop with an X to close. Render it from a route
 * presented as a native transparentModal, never inside an RN Modal: an RN Modal under a native
 * modal is dismissed natively while React still holds it, and the screen can't present another.
 */
export function ModalCard({ onClose, closeDisabled, children }: {
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Not an accessibility element, so the card's own fields and buttons stay reachable. */}
      <Pressable accessible={false} disabled={closeDisabled} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}>
        <BlurView intensity={20} tint={scheme} style={StyleSheet.absoluteFill} />
      </Pressable>
      <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.card }]}>
        {children}
        <Pressable
          testID="modal-close"
          accessibilityRole="button"
          accessibilityLabel="Close"
          disabled={closeDisabled}
          onPress={onClose}
          hitSlop={8}
          style={[styles.close, { backgroundColor: colors.cardAlt }]}
        >
          <IconSymbol name="xmark" size={14} color={colors.icon} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const CLOSE_SIZE = 30;
const PADDING = 24;

/** The shared modals' type and controls, so every one reads the same. */
export const modalStyles = StyleSheet.create({
  // Leaves room for the X on the first line.
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginRight: CLOSE_SIZE },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', marginRight: CLOSE_SIZE },
  name: { fontFamily: Fonts.serif, fontSize: 28, lineHeight: 34, marginTop: 4, marginRight: CLOSE_SIZE },
  copy: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 13, lineHeight: 18 },
  input: {
    ...InputText,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontSize: 17,
  },
  button: {
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '90%',
    maxWidth: 440,
    maxHeight: '86%',
    padding: PADDING,
    borderRadius: Radius.huge,
    boxShadow: Shadows.floating,
  },
  close: {
    position: 'absolute',
    top: PADDING - 4,
    right: PADDING - 4,
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
