import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface AddCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
}

export function AddCollectionModal({ visible, onClose, onAdd }: AddCollectionModalProps) {
  const [name, setName] = useState('');
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const scale = useSharedValue(0.95);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    if (visible) {
      scale.value = withSpring(1, { damping: 25, stiffness: 300 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      scale.value = withTiming(0.95, { duration: 150 });
      opacity.value = withTiming(0, { duration: 150 });
    }
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (name.trim() && !submitting) {
      setSubmitting(true);
      try {
        await onAdd(name.trim());
      } catch {
        // Error toast is shown by caller
      } finally {
        setSubmitting(false);
        setName('');
        onClose();
      }
    }
  };

  const handleClose = () => {
    setName('');
    onClose();
  };

  const cardBg = colors.card;
  const inputBg = colors.input;
  const borderColor = colors.border;
  const primaryColor = colors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <BlurView intensity={20} style={StyleSheet.absoluteFill} tint={isDark ? 'dark' : 'light'} />
        </Pressable>

        <Animated.View style={[styles.dialog, { backgroundColor: cardBg }, animatedStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconContainer, { backgroundColor: `${primaryColor}15` }]}>
                <IconSymbol name="folder.fill" size={22} color={primaryColor} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>New Collection</Text>
            </View>
            <Pressable onPress={handleClose} style={styles.closeButton}>
              <IconSymbol name="xmark" size={18} color={colors.icon} />
            </Pressable>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.text }]}>Collection Name</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: inputBg,
                  color: colors.text,
                  borderColor: borderColor,
                },
              ]}
              placeholder="e.g., Psalms of Comfort"
              placeholderTextColor={colors.icon}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <Text style={[styles.hint, { color: colors.icon }]}>
              Create a collection to organize verses by theme, book, or study plan.
            </Text>
          </View>

          {/* Buttons */}
          <View style={styles.buttons}>
            <Pressable
              style={[styles.button, styles.cancelButton, { borderColor }]}
              onPress={handleClose}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                styles.submitButton,
                { backgroundColor: primaryColor, opacity: name.trim() && !submitting ? 1 : 0.5 },
              ]}
              onPress={handleSubmit}
              disabled={!name.trim() || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.white }]}>Create Collection</Text>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  dialog: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 8,
    borderRadius: 8,
  },
  form: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  hint: {
    fontSize: 13,
    marginTop: 12,
    lineHeight: 18,
  },
  buttons: {
    flexDirection: 'row',
    padding: 20,
    paddingTop: 0,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  submitButton: {},
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
