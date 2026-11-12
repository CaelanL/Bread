import { JoinInvite } from '@/components/shared/JoinInvite';
import { ModalCard, modalStyles } from '@/components/ui/ModalCard';
import { Colors } from '@/constants/theme';
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
    <ModalCard onClose={close}>
      <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>Join with a code</Text>
      <Text style={[modalStyles.copy, styles.copy, { color: colors.icon }]}>Enter the 8-character code from your invite.</Text>
      <TextInput
        testID="join-code-input"
        style={[modalStyles.input, styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
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
        style={[modalStyles.button, { backgroundColor: ready ? colors.text : colors.borderLight }]}
      >
        <Text style={[modalStyles.buttonText, { color: ready ? colors.background : colors.icon }]}>Continue</Text>
      </Pressable>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  copy: { marginTop: 6, marginBottom: 20 },
  input: {
    height: 60,
    fontSize: 24,
    letterSpacing: 4,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
});
