import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionArt } from '@/components/collections/CollectionArt';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { VOTM } from '@/lib/api/votm';
import { formatReference } from '@/lib/bible';

interface VOTMCardProps {
  votm: VOTM;
  verseText: string | null;
  textLoading: boolean;
  masteryCount: number | null;
  userMastered: boolean;
  userHasVerse: boolean;
  version: string;
  onPress: () => void;
  onAddPress: () => void;
  onRetry: () => void;
}

const monthlyIcons = ['sunrise', 'dove', 'mountain', 'heart', 'lamp', 'globe'] as const;

export function VOTMCard({
  votm, verseText, textLoading, masteryCount, userMastered, userHasVerse,
  version, onPress, onAddPress, onRetry,
}: VOTMCardProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageKey = `${votm.id}:${votm.imageUrl}`;
  const hasImage = !!votm.imageUrl && failedImage !== imageKey;
  const month = Number(votm.yearMonth.slice(-2));
  const icon = monthlyIcons[(month - 1) % monthlyIcons.length] ?? 'sunrise';
  const reference = formatReference({ book: votm.book, chapter: votm.chapter, verse: votm.verseStart,
    verseEnd: votm.verseEnd === votm.verseStart ? undefined : votm.verseEnd });

  return (
    <Pressable
      testID="votm-card"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.card, opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={styles.art} testID={hasImage ? 'votm-cover' : 'votm-art-fallback'}>
        <CollectionArt icon={icon} size="hero" />
        {hasImage && (
          <Image
            source={{ uri: votm.imageUrl! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="disk"
            onError={() => setFailedImage(imageKey)}
            accessible={false}
          />
        )}
      </View>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <IconSymbol name="calendar" size={15} color={colors.icon} />
            <Text style={[styles.headerText, { color: colors.icon }]}>Verse of the Month</Text>
          </View>
          <IconSymbol name="arrow.up.left.and.arrow.down.right" size={14} color={colors.icon} />
        </View>
        <View style={styles.referenceRow}>
          <Text style={[styles.reference, { color: colors.text }]}>{reference}</Text>
          <Text style={[styles.version, { color: colors.icon }]}>{version}</Text>
        </View>
        {textLoading ? (
          <ActivityIndicator color={colors.icon} style={styles.loader} />
        ) : verseText ? (
          <Text testID="votm-text" style={[styles.verseText, { color: colors.text }]} numberOfLines={3}>{verseText}</Text>
        ) : (
          <Pressable testID="votm-retry" accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onRetry(); }}>
            <Text style={[styles.verseText, { color: colors.icon }]}>Unable to load verse text. Tap to retry.</Text>
          </Pressable>
        )}
        <View style={[styles.footer, masteryCount === null && styles.footerWithoutCount]}>
          {masteryCount !== null && <View style={styles.stat}>
            <IconSymbol name="person.2.fill" size={14} color={colors.icon} />
            <Text style={[styles.statText, { color: colors.icon }]}>
              {masteryCount} {masteryCount === 1 ? 'person has' : 'people have'} mastered
            </Text>
          </View>}
          {userMastered || userHasVerse ? (
            <View style={[styles.status, { backgroundColor: colors.primaryLight }]}>
              <IconSymbol name={userMastered ? 'checkmark.circle.fill' : 'book.fill'} size={14} color={userMastered ? colors.success : colors.primary} />
              <Text style={[styles.statusText, { color: userMastered ? colors.success : colors.primary }]}>
                {userMastered ? 'Mastered' : 'In Library'}
              </Text>
            </View>
          ) : (
            <Pressable
              testID="votm-add"
              accessibilityRole="button"
              accessibilityLabel="Add verse of the month to Library"
              style={({ pressed }) => [styles.status, { backgroundColor: colors.primaryLight, transform: [{ scale: pressed ? Motion.pressScale : 1 }] }]}
              onPress={(event) => { event.stopPropagation(); onAddPress(); }}
            >
              <IconSymbol name="plus" size={13} color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.primary }]}>Add to Library</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.huge, overflow: 'hidden' },
  art: { margin: 10, marginBottom: 0, borderRadius: Radius.xl, overflow: 'hidden' },
  content: { padding: 18, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  headerText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 },
  referenceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  reference: { fontFamily: Fonts.serif, fontSize: 25, fontWeight: '600' },
  version: { fontSize: 13, fontWeight: '500' },
  verseText: { fontSize: 16, lineHeight: 25 },
  loader: { alignSelf: 'flex-start', marginVertical: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  footerWithoutCount: { justifyContent: 'flex-end' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statText: { fontSize: 12, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, minHeight: 44, borderRadius: Radius.full },
  statusText: { fontSize: 13, fontWeight: '600' },
});
