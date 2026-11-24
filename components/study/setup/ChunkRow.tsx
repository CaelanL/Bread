import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** "Verses per chunk": a capsule showing the size (opens the picker) and an All capsule, solid when the passage is one chunk. */
export function ChunkRow({ chunkSize, totalVerses, onOpenPicker, onAll }: {
  chunkSize: number;
  totalVerses: number;
  onOpenPicker: () => void;
  onAll: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const all = chunkSize >= totalVerses;
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.text }]}>Verses per chunk</Text>
      <Pressable
        testID="chunk-size"
        accessibilityRole="button"
        accessibilityLabel={`Verses per chunk, ${Math.min(chunkSize, totalVerses)}`}
        onPress={onOpenPicker}
        style={({ pressed }) => [styles.capsule, styles.value, { backgroundColor: colors.controlFill }, pressed && styles.pressed]}
      >
        <Text style={[styles.valueText, { color: colors.text }]}>{Math.min(chunkSize, totalVerses)}</Text>
        <IconSymbol name="chevron.right" size={12} color={colors.icon} />
      </Pressable>
      <Pressable
        testID="chunk-all"
        accessibilityRole="button"
        accessibilityState={{ selected: all }}
        onPress={onAll}
        style={({ pressed }) => [
          styles.capsule,
          { backgroundColor: all ? colors.primary : colors.controlFill },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.allText, { color: all ? colors.white : colors.text }]}>All</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, minHeight: 40 },
  label: { flex: 1, fontSize: 17, fontWeight: '600' },
  capsule: { height: 34, paddingHorizontal: 14, borderRadius: Radius.full, justifyContent: 'center', alignItems: 'center' },
  value: { flexDirection: 'row', gap: 4, paddingHorizontal: 12 },
  valueText: { fontSize: 15, fontWeight: '600' },
  allText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
