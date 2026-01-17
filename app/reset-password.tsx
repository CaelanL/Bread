import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ResetPasswordScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { updatePassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const buttonBg = colors.primary;
  const inputBg = colors.input;
  const borderColor = colors.border;

  const handleResetPassword = async () => {
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);

    if (error) {
      Alert.alert('Error', error);
    } else {
      Alert.alert('Success', 'Your password has been updated', [
        {
          text: 'OK',
          onPress: () => router.replace('/(auth)/sign-in'),
        },
      ]);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: colors.primaryLight }]}>
            <IconSymbol name="lock.fill" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Set New Password</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            Enter your new password below
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={[styles.inputContainer, { backgroundColor: inputBg, borderColor }]}>
            <IconSymbol name="lock.fill" size={18} color={colors.icon} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="New password"
              placeholderTextColor={colors.icon}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={[styles.inputContainer, { backgroundColor: inputBg, borderColor }]}>
            <IconSymbol name="lock.fill" size={18} color={colors.icon} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Confirm password"
              placeholderTextColor={colors.icon}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
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
              <Text style={styles.buttonText}>Update Password</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
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
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
