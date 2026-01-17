import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatVerseReference } from '@/lib/storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface VerseReferenceBadgeProps {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: string;
  showAddButton?: boolean;
  onAddPress?: () => void;
}

export function VerseReferenceBadge({
  book,
  chapter,
  verseStart,
  verseEnd,
  version,
  showAddButton = false,
  onAddPress,
}: VerseReferenceBadgeProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const accentColor = colors.tint;
  const badgeBg = colors.primaryLight;

  const reference = formatVerseReference({
    book,
    chapter,
    verseStart,
    verseEnd,
  } as any);

  return (
    <View style={styles.container}>
      {/* Reference badge */}
      <View style={[styles.badge, { backgroundColor: badgeBg }]}>
        <IconSymbol name="book.fill" size={14} color={accentColor} />
        <Text style={[styles.badgeText, { color: accentColor }]}>{reference}</Text>
      </View>

      {/* Version tag */}
      <Text style={[styles.versionText, { color: accentColor }]}>{version}</Text>

      {/* Add button */}
      {showAddButton && onAddPress && (
        <Pressable
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: badgeBg },
            pressed && { opacity: 0.7 },
          ]}
          onPress={onAddPress}
          hitSlop={8}
        >
          <IconSymbol name="plus" size={16} color={accentColor} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  versionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
