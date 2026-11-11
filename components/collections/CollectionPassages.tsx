import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchVerse } from '@/lib/api/bible';
import type { CollectionPassage } from '@/lib/collections/catalog';
import { collectionPassageReference, readCollectionPassage } from '@/lib/collections/passages';
import type { BibleVersion } from '@/lib/settings';

function PassagePreview({ passage, version }: { passage: CollectionPassage; version: BibleVersion }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    readCollectionPassage(passage, version, fetchVerse, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setText(value);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [passage, version, attempt]);

  return (
    <View style={styles.preview}>
      {error ? (
        <>
          <Text style={[styles.error, { color: colors.text }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.retry}
            onPress={() => {
              setError(undefined);
              setAttempt(attempt + 1);
            }}
          >
            <Text style={[styles.retryText, { color: colors.text }]}>Try again</Text>
          </Pressable>
        </>
      ) : text ? (
        <Text testID="curated-preview-text" style={[styles.verseText, { color: colors.text }]}>{text}</Text>
      ) : (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading passage" />
      )}
    </View>
  );
}

export function CollectionPassages({ passages, version }: {
  passages: readonly CollectionPassage[];
  version: BibleVersion;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [expandedIndex, setExpandedIndex] = useState<number>();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Passages</Text>
      {passages.map((passage, index) => {
        const reference = collectionPassageReference(passage);
        const expanded = expandedIndex === index;
        return (
          <View key={reference} style={[styles.card, {
            backgroundColor: index === 0 ? colors.cardAlt : colors.card,
            borderColor: colors.border,
          }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={index === 0 ? `Start here, ${reference}` : reference}
              accessibilityState={{ expanded }}
              testID={`curated-passage-${index}`}
              style={styles.row}
              onPress={() => setExpandedIndex(expanded ? undefined : index)}
            >
              <View style={styles.rowText}>
                {index === 0 && (
                  <Text style={[styles.eyebrow, { color: colors.icon }]}>START HERE</Text>
                )}
                <Text style={[styles.reference, { color: colors.text }]}>{reference}</Text>
              </View>
              <IconSymbol name={expanded ? 'chevron.down' : 'chevron.right'} size={16} color={colors.icon} />
            </Pressable>
            {expanded && <PassagePreview key={version} passage={passage} version={version} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { fontSize: 21, fontWeight: '700' },
  card: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, padding: 12, gap: 12 },
  rowText: { flex: 1, gap: 4 },
  reference: { fontSize: 16, fontWeight: '600' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  preview: { paddingHorizontal: 12, paddingBottom: 12 },
  verseText: { fontFamily: Fonts?.serif, fontSize: 19, lineHeight: 29 },
  error: { fontSize: 14, lineHeight: 21 },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
