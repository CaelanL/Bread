import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { VOTM } from '@/lib/api/votm';
import { formatVerseReference } from '@/lib/storage';
import { ActivityIndicator, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';

interface VOTMCardProps {
  votm: VOTM;
  verseText: string | null;
  textLoading: boolean;
  masteryCount: number;
  userMastered: boolean;
  userHasVerse: boolean;
  version: string;
  onPress: () => void;
  onAddPress: () => void;
}

export function VOTMCard({
  votm,
  verseText,
  textLoading,
  masteryCount,
  userMastered,
  userHasVerse,
  version,
  onPress,
  onAddPress,
}: VOTMCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const hasImage = !!votm.imageUrl;

  // Colors change when we have a background image
  const accentColor = hasImage ? colors.white : colors.primary;
  const textColor = hasImage ? colors.white : colors.text;
  const subtextColor = hasImage ? 'rgba(255,255,255,0.7)' : colors.icon;
  const badgeBg = hasImage
    ? 'rgba(255,255,255,0.2)'
    : colors.primaryLight;
  const cardBg = colors.cardAlt;

  // Format reference for display
  const reference = formatVerseReference({
    book: votm.book,
    chapter: votm.chapter,
    verseStart: votm.verseStart,
    verseEnd: votm.verseEnd,
  } as any);

  const cardContent = (
    <View style={styles.contentWrapper}>
      {/* Overlay for image background */}
      {hasImage && <View style={styles.overlay} />}

      {/* Content */}
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <IconSymbol name="calendar" size={16} color={accentColor} />
            <Text style={[styles.headerText, { color: accentColor }]}>
              Verse of the Month
            </Text>
          </View>
          <IconSymbol name="arrow.up.left.and.arrow.down.right" size={14} color={subtextColor} />
        </View>

        {/* Reference Badge */}
        <View style={styles.badgeRow}>
          <View style={[styles.referenceBadge, { backgroundColor: badgeBg }]}>
            <IconSymbol name="book.fill" size={14} color={accentColor} />
            <Text style={[styles.referenceText, { color: accentColor }]}>
              {reference}
            </Text>
          </View>
          <Text style={[styles.versionText, { color: subtextColor }]}>
            {version}
          </Text>
        </View>

        {/* Verse Text */}
        {textLoading ? (
          <ActivityIndicator size="small" color={subtextColor} style={styles.loader} />
        ) : (
          <Text style={[styles.verseText, { color: textColor }]} numberOfLines={3}>
            {verseText || 'Unable to load verse text'}
          </Text>
        )}

        {/* Footer Stats */}
        <View style={styles.footer}>
          {/* Mastery Count */}
          <View style={styles.stat}>
            <IconSymbol name="person.2.fill" size={14} color={subtextColor} />
            <Text style={[styles.statText, { color: subtextColor }]}>
              {masteryCount} {masteryCount === 1 ? 'person has' : 'people have'} mastered
            </Text>
          </View>

          {/* User Status */}
          {userMastered ? (
            <View style={[styles.statusBadge, { backgroundColor: hasImage ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.15)' }]}>
              <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
              <Text style={[styles.statusText, { color: colors.success }]}>
                Mastered
              </Text>
            </View>
          ) : userHasVerse ? (
            <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
              <IconSymbol name="book.fill" size={12} color={accentColor} />
              <Text style={[styles.statusText, { color: accentColor }]}>
                In Library
              </Text>
            </View>
          ) : (
            <Pressable
              style={[styles.statusBadge, { backgroundColor: badgeBg }]}
              onPress={(e) => {
                e.stopPropagation();
                onAddPress();
              }}
              hitSlop={8}
            >
              <IconSymbol name="plus" size={12} color={accentColor} />
              <Text style={[styles.statusText, { color: accentColor }]}>
                Add to Library
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  if (hasImage) {
    return (
      <Pressable onPress={onPress}>
        <ImageBackground
          source={{ uri: votm.imageUrl! }}
          style={styles.card}
          imageStyle={styles.backgroundImage}
          resizeMode="cover"
        >
          {cardContent}
        </ImageBackground>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.card, { backgroundColor: cardBg }]}
      onPress={onPress}
    >
      {cardContent}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  backgroundImage: {
    borderRadius: 16,
  },
  contentWrapper: {
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  referenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  referenceText: {
    fontSize: 15,
    fontWeight: '600',
  },
  versionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  verseText: {
    fontSize: 16,
    lineHeight: 24,
  },
  loader: {
    alignSelf: 'flex-start',
    marginVertical: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 13,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
