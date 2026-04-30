/**
 * Info modal for the Notifications page. Explains the difference
 * between the two notification sources — Reviews vs. In-progress —
 * since the section titles alone aren't enough.
 *
 * Mirrors the visual pattern of `ProgressInfoModal` so the
 * iconography and feel are consistent across the app.
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function NotificationInfoModal({ visible, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView
        intensity={isDark ? 40 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={styles.blurOverlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>About notifications</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={styles.section}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(176, 141, 87, 0.1)' }]}>
                <IconSymbol name="checkmark.circle.fill" size={22} color={colors.tint} />
              </View>
              <View style={styles.textContent}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Review reminders</Text>
                <Text style={[styles.description, { color: colors.icon }]}>
                  A nudge when mastered verses are ready for review.
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(176, 141, 87, 0.1)' }]}>
                <IconSymbol name="hourglass" size={22} color={colors.tint} />
              </View>
              <View style={styles.textContent}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>In-progress nudge</Text>
                <Text style={[styles.description, { color: colors.icon }]}>
                  A nudge to come back to verses you&apos;ve started but haven&apos;t mastered yet.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

export function NotificationInfoButton({ onPress }: { onPress: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.infoButton}>
      <MaterialCommunityIcons
        name="information-outline"
        size={20}
        color={colors.icon}
        style={{ opacity: 0.7 }}
      />
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
  infoButton: {
    padding: 4,
  },
});
