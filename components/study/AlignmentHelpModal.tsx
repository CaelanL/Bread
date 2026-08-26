import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AlignmentWord } from '@/lib/study-chunks';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface AlignmentHelpModalProps {
  visible: boolean;
  onClose: () => void;
}

// Example showing statuses with full John 3:16
const EXAMPLE_ALIGNMENT: AlignmentWord[] = [
  { word: 'For', status: 'correct' },
  { word: 'God', status: 'correct' },
  { word: 'so', status: 'correct' },
  { word: 'loved', status: 'correct' },
  { word: 'the', status: 'correct' },
  { word: 'world', status: 'missing' },
  { word: 'earth', status: 'added' },
  { word: 'that', status: 'correct' },
  { word: 'he', status: 'correct' },
  { word: 'gave', status: 'correct' },
  { word: 'his', status: 'correct' },
  { word: 'one', status: 'correct' },
  { word: 'and', status: 'correct' },
  { word: 'only', status: 'correct' },
  { word: 'Son,', status: 'correct' },
  { word: 'that', status: 'missing' },
  { word: 'whoever', status: 'missing' },
  { word: 'believes', status: 'missing' },
  { word: 'in', status: 'missing' },
  { word: 'him', status: 'missing' },
  { word: 'shall', status: 'missing' },
  { word: 'not', status: 'missing' },
  { word: 'perish', status: 'missing' },
  { word: 'but', status: 'missing' },
  { word: 'have', status: 'missing' },
  { word: 'eternal', status: 'missing' },
  { word: 'life.', status: 'missing' },
];

// Colors for alignment statuses (matching ResultCard)
const STATUS_COLORS = {
  correct: {
    text: undefined, // uses default text color
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.2)',
  },
  missing: {
    text: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.2)',
  },
  added: {
    text: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.2)',
  },
};

interface LegendItemProps {
  status: 'correct' | 'missing' | 'added';
  title: string;
  description: string;
  example: string;
  textColor: string;
}

function LegendItem({ status, title, description, example, textColor }: LegendItemProps) {
  const colors = STATUS_COLORS[status];

  const getExampleElement = () => {
    switch (status) {
      case 'correct':
        return <Text style={[styles.legendExample, { color: textColor }]}>{example}</Text>;
      case 'missing':
        return (
          <Text style={[styles.legendExample, styles.missingWord]}>{example}</Text>
        );
      case 'added':
        return (
          <Text style={[styles.legendExample, styles.addedWord]}>{example}</Text>
        );
    }
  };

  return (
    <View style={[styles.legendItem, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <View style={styles.legendHeader}>
        {getExampleElement()}
        <Text style={[styles.legendDash, { color: textColor }]}>—</Text>
        <Text style={[styles.legendTitle, { color: textColor }]}>{title}</Text>
      </View>
      <Text style={[styles.legendDescription, { color: textColor, opacity: 0.7 }]}>
        {description}
      </Text>
    </View>
  );
}

function ExampleWord({ item, textColor }: { item: AlignmentWord; textColor: string }) {
  switch (item.status) {
    case 'correct':
      return <Text style={{ color: textColor }}>{item.word}</Text>;
    case 'missing':
      return <Text style={styles.missingWord}>{item.word}</Text>;
    case 'added':
      return <Text style={styles.addedWord}>{item.word}</Text>;
    default:
      return <Text style={{ color: textColor }}>{item.word}</Text>;
  }
}

function ExampleAlignment({ textColor }: { textColor: string }) {
  return (
    <Text style={styles.exampleText}>
      {EXAMPLE_ALIGNMENT.map((item, i) => (
        <Text key={i}>
          <ExampleWord item={item} textColor={textColor} />
          {i < EXAMPLE_ALIGNMENT.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
}

export function AlignmentHelpModal({ visible, onClose }: AlignmentHelpModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const modalBg = colors.card;
  const exampleBg = colors.input;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.modal, { backgroundColor: modalBg }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <IconSymbol name="questionmark.circle" size={20} color={colors.tint} />
              <Text style={[styles.title, { color: colors.text }]}>Understanding Your Results</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <IconSymbol name="xmark" size={18} color={colors.icon} />
            </Pressable>
          </View>

          {/* Scrollable content */}
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {/* Example section */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.icon }]}>Example: John 3:16</Text>
              <View style={[styles.exampleContainer, { backgroundColor: exampleBg }]}>
                <ExampleAlignment textColor={colors.text} />
              </View>
              <Text style={[styles.exampleCaption, { color: colors.icon }]}>
                In this example, you said "earth" instead of "world", then stopped reciting after "Son".
              </Text>
            </View>

            {/* Legend section */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.icon }]}>Legend</Text>

              <LegendItem
                status="correct"
                title="Correct"
                example="loved"
                description="You said this word correctly — nice work!"
                textColor={colors.text}
              />

              <LegendItem
                status="missing"
                title="Missed"
                example="world"
                description="This word was in the verse, but you skipped it or said something different."
                textColor={colors.text}
              />

              <LegendItem
                status="added"
                title="Extra"
                example="earth"
                description="You said this word, but it wasn't in the original verse."
                textColor={colors.text}
              />
            </View>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    // No flex: 1 - let ScrollView size to content, maxHeight on modal will constrain
  },
  contentInner: {
    padding: 16,
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  exampleContainer: {
    padding: 12,
    borderRadius: 10,
  },
  exampleText: {
    fontSize: 16,
    lineHeight: 24,
  },
  exampleCaption: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  legendItem: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendExample: {
    fontSize: 15,
    fontWeight: '600',
  },
  legendDash: {
    fontSize: 13,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  legendDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Word styles matching ResultCard
  missingWord: {
    color: '#f59e0b',
    textDecorationLine: 'underline',
  },
  addedWord: {
    color: '#ef4444',
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
});
