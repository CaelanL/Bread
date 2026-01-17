import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, authAccent } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ForgotPasswordScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  const emailRef = useRef<TextInput>(null);

  const buttonBg = authAccent;
  const inputBg = colors.input;
  const borderColor = colors.border;

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }

    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);

    if (error) {
      Alert.alert('Error', error);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <View style={styles.successContainer}>
            <View style={[styles.successIcon, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
              <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
            </View>
            <Text style={[styles.successTitle, { color: colors.text }]}>Check Your Email</Text>
            <Text style={[styles.successText, { color: colors.icon }]}>
              We sent a password reset link to{'\n'}
              <Text style={{ fontWeight: '600', color: colors.text }}>{email}</Text>
            </Text>
            <Pressable
              style={[styles.button, { backgroundColor: buttonBg, paddingHorizontal: 32 }]}
              onPress={() => router.back()}
            >
              <Text style={[styles.buttonText, { fontSize: 16 }]}>Back to Sign In</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      bottomOffset={20}
    >
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            onPress={() => router.back()}
          >
            <IconSymbol name="chevron.left" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Reset Password</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            Enter your email and we'll send you a link to reset your password
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: inputBg, borderColor },
              emailFocused && { borderColor: authAccent },
            ]}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => emailRef.current?.focus()}
          >
            <IconSymbol name="envelope.fill" size={18} color={emailFocused ? authAccent : colors.icon} />
            <TextInput
              ref={emailRef}
              style={[styles.input, { color: colors.text }]}
              placeholder="Email"
              placeholderTextColor={colors.icon}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: buttonBg },
              loading && { opacity: 0.7 },
              pressed && !loading && { opacity: 0.8, transform: [{ scale: 0.98 }] },
            ]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Send Reset Link</Text>
            )}
          </Pressable>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.icon }]}>
            Remember your password?{' '}
          </Text>
          <Pressable
            style={({ pressed }) => pressed && { opacity: 0.7 }}
            onPress={() => router.back()}
          >
            <Text style={[styles.link, { color: buttonBg }]}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 40,
  },
  backButton: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#3a3a3a',
    fontSize: 17,
    fontWeight: '600',
  },
  link: {
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  footerText: {
    fontSize: 15,
  },
  successContainer: {
    alignItems: 'center',
    gap: 16,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  successText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
