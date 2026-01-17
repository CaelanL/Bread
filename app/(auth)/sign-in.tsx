import { useState, useRef } from 'react';
import { useFonts, PlayfairDisplay_400Regular } from '@expo-google-fonts/playfair-display';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { Colors, authAccent } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function SignInScreen() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
  });
  // Auth screens are always dark mode
  const colors = Colors.dark;
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const buttonBg = authAccent;
  const inputBg = colors.input;
  const borderColor = colors.border;

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert('Sign In Failed', error);
    }
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
          <View style={styles.logoRow}>
            <View style={styles.logoContainer}>
              <Image
                source={require('@/assets/images/logo-bird.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, { color: authAccent }]}>Bread</Text>
          </View>
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
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />
            <Pressable hitSlop={12} onPress={() => setShowPassword(!showPassword)}>
              <IconSymbol
                name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
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
            onPress={handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </Pressable>

          {/* Forgot Password */}
          <Pressable
            style={({ pressed }) => pressed && { opacity: 0.7 }}
            onPress={() => router.push('/(auth)/forgot-password')}
          >
            <Text style={[styles.link, { color: buttonBg }]}>Forgot password?</Text>
          </Pressable>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.icon }]}>
            Don't have an account?{' '}
          </Text>
          <Pressable
            style={({ pressed }) => pressed && { opacity: 0.7 }}
            onPress={() => router.push('/(auth)/sign-up')}
          >
            <Text style={[styles.link, { color: buttonBg }]}>Sign up</Text>
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
    alignItems: 'center',
    marginBottom: 40,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  logoContainer: {
    width: 47,
    height: 51,
    overflow: 'hidden',
  },
  logo: {
    width: 51,
    height: 51,
    marginLeft: -4,
  },
  title: {
    fontSize: 35,
    fontFamily: 'Avenir Next',
    fontWeight: '400',
    letterSpacing: -0.5,
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
    textAlign: 'center',
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
