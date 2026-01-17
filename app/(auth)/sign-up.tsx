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

export default function SignUpScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const buttonBg = authAccent;
  const inputBg = colors.input;
  const borderColor = colors.border;

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert('Sign Up Failed', error);
    }
    // No alert on success - user is logged in automatically
  };

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
          <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            Sign up to start memorizing
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
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          <View
            style={[
              styles.inputContainer,
              { backgroundColor: inputBg, borderColor },
              passwordFocused && { borderColor: authAccent },
            ]}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => passwordRef.current?.focus()}
          >
            <IconSymbol name="lock.fill" size={18} color={passwordFocused ? authAccent : colors.icon} />
            <TextInput
              ref={passwordRef}
              style={[styles.input, { color: colors.text }]}
              placeholder="Password"
              placeholderTextColor={colors.icon}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />
            <Pressable hitSlop={12} onPress={() => setShowPassword(!showPassword)}>
              <IconSymbol
                name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
                size={18}
                color={colors.icon}
              />
            </Pressable>
          </View>

          <View
            style={[
              styles.inputContainer,
              { backgroundColor: inputBg, borderColor },
              confirmFocused && { borderColor: authAccent },
            ]}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => confirmRef.current?.focus()}
          >
            <IconSymbol name="lock.fill" size={18} color={confirmFocused ? authAccent : colors.icon} />
            <TextInput
              ref={confirmRef}
              style={[styles.input, { color: colors.text }]}
              placeholder="Confirm Password"
              placeholderTextColor={colors.icon}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onFocus={() => setConfirmFocused(true)}
              onBlur={() => setConfirmFocused(false)}
              secureTextEntry={!showConfirmPassword}
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
            />
            <Pressable hitSlop={12} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
              <IconSymbol
                name={showConfirmPassword ? 'eye.slash.fill' : 'eye.fill'}
                size={18}
                color={colors.icon}
              />
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: buttonBg },
              loading && { opacity: 0.7 },
              pressed && !loading && { opacity: 0.8, transform: [{ scale: 0.98 }] },
            ]}
            onPress={handleSignUp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </Pressable>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.icon }]}>
            Already have an account?{' '}
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
});
