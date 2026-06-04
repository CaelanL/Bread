/**
 * Verses-per-chunk picker for the Study Setup screen. Lightweight
 * compared to the notification modals — no header, no Cancel/Save.
 * Tap an option, it commits and dismisses. Tap outside to dismiss
 * without changing anything.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  totalVerses: number;
  initialChunkSize: number;
  onSave: (chunkSize: number) => void;
  onClose: () => void;
}

export function ChunkSizeModal({ visible, totalVerses, initialChunkSize, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const handlePick = (n: number) => {
    onSave(n);
    onClose();
  };

  // 1..totalVerses-1 as numeric options; "All" as the final option
  // (sets size to totalVerses, redundant with picking N directly).
  const numericOptions = Array.from({ length: Math.max(0, totalVerses - 1) }, (_, i) => i + 1);
  const isAllSelected = initialChunkSize >= totalVerses;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.cardAlt }]}
          onStartShouldSetResponder={() => true}
        >
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {numericOptions.map((n) => {
              const isSelected = !isAllSelected && initialChunkSize === n;
              return (
                <Pressable
                  key={n}
                  style={[
                    styles.option,
                    isSelected && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => handlePick(n)}
                >
                  <Text style={[styles.optionLabel, { color: isSelected ? colors.white : colors.text }]}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[
                styles.option,
                isAllSelected && { backgroundColor: colors.primary },
              ]}
              onPress={() => handlePick(totalVerses)}
            >
              <Text style={[styles.optionLabel, { color: isAllSelected ? colors.white : colors.text }]}>
                All
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '60%',
    maxHeight: '60%',
    borderRadius: 14,
    paddingVertical: 6,
  },
  scroll: {
    flexGrow: 0,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 6,
    marginVertical: 2,
    alignItems: 'center',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
});
