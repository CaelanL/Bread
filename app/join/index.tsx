import { JoinInvite } from '@/components/shared/JoinInvite';
import { SheetLayout } from '@/components/ui/BottomSheet';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/lib/shared/invite-code';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

/** The typed-code entry: chat apps rarely make com.biblemem:// links tappable, so this always works. */
export default function JoinCodeScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const ready = code.length === INVITE_CODE_LENGTH;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(library)');
  };

  // The invite opens in place: replacing this modal with the link route hid the new one from accessibility.
  const next = () => {
    if (ready) setSubmitted(true);
  };

  if (submitted) return <JoinInvite code={code} />;

  return (
    <SheetLayout onClose={close}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Join with a code</Text>
      <Text style={[styles.copy, { color: colors.icon }]}>Enter the 8-character code from your invite.</Text>
      <TextInput
        testID="join-code-input"
        style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        value={code}
        onChangeText={(value) => setCode(normalizeInviteCode(value))}
        placeholder="ABCD2345"
        placeholderTextColor={colors.icon}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={next}
      />
      <Pressable
        testID="join-code-continue"
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={next}
        style={[styles.button, { backgroundColor: ready ? colors.text : colors.borderLight }]}
      >
        <Text style={[styles.buttonText, { color: ready ? colors.background : colors.icon }]}>Continue</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={close} style={styles.ghost}>
        <Text style={[styles.ghostText, { color: colors.icon }]}>Not now</Text>
      </Pressable>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginBottom: 6 },
  copy: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  input: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    fontSize: 22,
    letterSpacing: 4,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  ghost: { alignItems: 'center', paddingTop: 14, paddingBottom: 4 },
  ghostText: { fontSize: 15, fontWeight: '500' },
});
