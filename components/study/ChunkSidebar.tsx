import { getScoreColor } from '@/components/study/ResultCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadows, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const CHUNK_SIDEBAR_WIDTH = 320;

export interface ChunkRowInfo {
  label: string;
  /** The chunk's text, shown once it has a result (never before: it would give the answer away). */
  text?: string;
  /** The recited score, once it has a result. */
  score?: number;
  /** Revealed before it had a result: this chunk won't count. */
  peeked: boolean;
}

/**
 * A session's chunks on a wide window (the Recite-C2, Result-C2 and Finish-C2 boards): the reference,
 * difficulty and chunk count, then a row per chunk (done with its score, current, or not yet) and a
 * Results row once every chunk is done. A tap goes to that chunk, as a swipe would.
 */
export function ChunkSidebar({ top, reference, subtitle, rows, results, current, disabled, onSelect }: {
  /** Where the content starts, under the sidebar button. */
  top: number;
  reference: string;
  subtitle: string;
  rows: ChunkRowInfo[];
  /** The final score once every chunk is done; the Results row shows only then. */
  results?: number;
  current: number;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const all = results === undefined ? rows : [...rows, { label: 'Results', score: results, peeked: false }];
  return (
    <ScrollView
      style={{ backgroundColor: colors.cardAlt }}
      contentContainerStyle={[styles.content, { paddingTop: top }]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{reference}</Text>
      <Text style={[styles.subtitle, { color: colors.icon }]}>{subtitle}</Text>
      <View style={styles.rows}>
        {all.map((row, index) => {
          const isResults = index === rows.length;
          const selected = index === current;
          const done = !isResults && row.score !== undefined;
          const label = [
            row.label,
            row.score !== undefined && `score ${row.score}%`,
            selected && 'current',
            !done && !isResults && !selected && 'not recited yet',
          ].filter(Boolean).join(', ');
          return (
            <Pressable
              key={row.label + index}
              testID={isResults ? 'chunk-row-results' : `chunk-row-${index}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.row,
                selected && { backgroundColor: colors.card, borderColor: withAlpha(colors.primary, 0.35), boxShadow: Shadows.card },
                pressed && !selected && { backgroundColor: colors.fill },
              ]}
            >
              {done ? (
                <View style={[styles.mark, { backgroundColor: colors.success }]}>
                  <IconSymbol name="checkmark" size={14} color={colors.white} />
                </View>
              ) : (
                <View style={[styles.mark, styles.ring, { borderColor: selected ? colors.primary : colors.border }, selected && styles.ringCurrent]}>
                  {selected && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: done || selected ? colors.text : colors.icon }]}>{row.label}</Text>
                {row.text !== undefined && (
                  <Text numberOfLines={1} style={[styles.line, { color: colors.icon }]}>{row.text}</Text>
                )}
                {row.peeked && (
                  <View style={styles.peeked}>
                    <IconSymbol name="eye" size={13} color={colors.icon} />
                    <Text style={[styles.peekedText, { color: colors.icon }]}>Revealed — this chunk won’t count</Text>
                  </View>
                )}
              </View>
              {row.score !== undefined && (
                <View style={[styles.score, { backgroundColor: `${getScoreColor(row.score)}20` }]}>
                  <Text style={[styles.scoreText, { color: getScoreColor(row.score) }]}>{row.score}%</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingLeft: 20, paddingRight: 16, paddingBottom: 20 },
  title: { paddingLeft: 4, fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { paddingLeft: 4, marginTop: 2, fontSize: 13 },
  rows: { marginTop: 16, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  mark: { width: 26, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 1.5 },
  ringCurrent: { borderWidth: 2 },
  dot: { width: 10, height: 10, borderRadius: Radius.full },
  rowText: { flex: 1, minWidth: 0 },
  label: { fontSize: 16, fontWeight: '600' },
  line: { fontSize: 13 },
  peeked: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  peekedText: { fontSize: 12, fontWeight: '500' },
  score: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.lg },
  scoreText: { fontSize: 13, fontWeight: '600' },
});
