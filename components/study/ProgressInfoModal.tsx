import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface ProgressInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ProgressInfoModal({ visible, onClose }: ProgressInfoModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const greenColor = colors.success;
  const goldColor = colors.tint;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <BlurView intensity={isDark ? 40 : 80} tint={isDark ? 'dark' : 'light'} style={styles.blurOverlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Understanding Your Progress</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </Pressable>
          </View>

          <View style={styles.content}>
            {/* Mastered Section */}
            <View style={styles.section}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(34, 197, 94, 0.1)' }]}>
                <IconSymbol name="checkmark" size={24} color={greenColor} />
              </View>
              <View style={styles.textContent}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Mastered</Text>
                <Text style={[styles.description, { color: colors.icon }]}>
                  Score <Text style={[styles.highlight, { color: greenColor }]}>90%+</Text> on Hard difficulty
                </Text>
              </View>
            </View>

            {/* Engraved Section */}
            <View style={styles.section}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(176, 141, 87, 0.1)' }]}>
                <EngravedIcon size={23} color={goldColor} />
              </View>
              <View style={styles.textContent}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Engraved</Text>
                <Text style={[styles.description, { color: colors.icon }]}>
                  Master the verse <Text style={[styles.highlight, { color: goldColor }]}>once per month</Text> for{' '}
                  <Text style={[styles.highlight, { color: goldColor }]}>4 consecutive months</Text>
                </Text>
              </View>
            </View>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

// Info button trigger component
export function ProgressInfoButton({ onPress }: { onPress: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.infoButton}>
      <MaterialCommunityIcons name="information-outline" size={16} color={colors.icon} style={{ opacity: 0.7 }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blurOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    gap: 16,
  },
  section: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContent: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  highlight: {
    fontWeight: '600',
  },
  infoButton: {
    padding: 4,
  },
});
