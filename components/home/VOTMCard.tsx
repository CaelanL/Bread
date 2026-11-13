import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { CardSurface, Colors, MonthlyCardColors, Radius } from '@/constants/theme';
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

export function VOTMCard({
  votm, verseText, textLoading, masteryCount, userMastered, userHasVerse,
  version, onPress, onAddPress, onRetry,
}: VOTMCardProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageKey = `${votm.id}:${votm.imageUrl}`;
  const hasImage = !!votm.imageUrl && failedImage !== imageKey;
  const accentColor = hasImage ? colors.white : colors.primary;
  const textColor = hasImage ? colors.white : colors.text;
  const subtextColor = hasImage ? MonthlyCardColors.subtext : colors.icon;
  const badgeBg = hasImage ? MonthlyCardColors.badge : colors.primaryLight;
  const reference = formatReference({ book: votm.book, chapter: votm.chapter, verse: votm.verseStart,
    verseEnd: votm.verseEnd === votm.verseStart ? undefined : votm.verseEnd });

  return (
    <Pressable
      testID="votm-card"
      onPress={onPress}
      style={[styles.card, { backgroundColor: hasImage ? colors.shadow : colors.cardAlt }]}
    >
      {hasImage && (
        <Image
          testID="votm-cover"
          source={{ uri: votm.imageUrl! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
          onError={() => setFailedImage(imageKey)}
          accessible={false}
        />
      )}
      <View style={styles.contentWrapper} testID={hasImage ? undefined : 'votm-art-fallback'}>
        {hasImage && <View style={styles.overlay} />}
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <IconSymbol name="calendar" size={16} color={accentColor} />
              <Text style={[styles.headerText, { color: accentColor }]}>Verse of the Month</Text>
            </View>
            <IconSymbol name="arrow.up.left.and.arrow.down.right" size={14} color={subtextColor} />
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.referenceBadge, { backgroundColor: badgeBg }]}>
              <IconSymbol name="book.fill" size={14} color={accentColor} />
              <Text style={[styles.referenceText, { color: accentColor }]}>{reference}</Text>
            </View>
            <Text style={[styles.versionText, { color: subtextColor }]}>{version}</Text>
          </View>
          {textLoading ? (
            <ActivityIndicator size="small" color={subtextColor} style={styles.loader} />
          ) : verseText ? (
            <Text testID="votm-text" style={[styles.verseText, { color: textColor }]} numberOfLines={3}>{verseText}</Text>
          ) : (
            <Pressable testID="votm-retry" accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onRetry(); }}>
              <Text style={[styles.verseText, { color: subtextColor }]}>Unable to load verse text. Tap to retry.</Text>
            </Pressable>
          )}
          <View style={[styles.footer, masteryCount === null && styles.footerWithoutCount]}>
            {masteryCount !== null && <View style={styles.stat}>
              <IconSymbol name="person.2.fill" size={14} color={subtextColor} />
              <Text style={[styles.statText, { color: subtextColor }]}>
                {masteryCount} {masteryCount === 1 ? 'person has' : 'people have'} mastered
              </Text>
            </View>}
            {userMastered || userHasVerse ? (
              <View style={[styles.statusBadge, { backgroundColor: userMastered ? (hasImage ? MonthlyCardColors.masteredImage : MonthlyCardColors.masteredPlain) : badgeBg }]}>
                <IconSymbol name={userMastered ? 'checkmark.circle.fill' : 'book.fill'} size={userMastered ? 14 : 12} color={userMastered ? colors.success : accentColor} />
                <Text style={[styles.statusText, { color: userMastered ? colors.success : accentColor }]}>
                  {userMastered ? 'Mastered' : 'In Library'}
                </Text>
              </View>
            ) : (
              <Pressable
                testID="votm-add"
                accessibilityRole="button"
                accessibilityLabel="Add verse of the month to Library"
                style={[styles.statusBadge, { backgroundColor: badgeBg }]}
                hitSlop={8}
                onPress={(event) => { event.stopPropagation(); onAddPress(); }}
              >
                <IconSymbol name="plus" size={12} color={accentColor} />
                <Text style={[styles.statusText, { color: accentColor }]}>Add to Library</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...CardSurface, overflow: 'hidden' },
  contentWrapper: { position: 'relative' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: MonthlyCardColors.overlay },
  content: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerText: { fontSize: 14, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  referenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.xxxl },
  referenceText: { fontSize: 15, fontWeight: '600' },
  versionText: { fontSize: 14, fontWeight: '500' },
  verseText: { fontSize: 16, lineHeight: 24 },
  loader: { alignSelf: 'flex-start', marginVertical: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 8 },
  footerWithoutCount: { justifyContent: 'flex-end' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statText: { fontSize: 13, flexShrink: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.lg },
  statusText: { fontSize: 13, fontWeight: '600' },
});
