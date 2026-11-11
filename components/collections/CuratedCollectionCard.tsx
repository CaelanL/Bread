import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionArt } from '@/components/collections/CollectionArt';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { CuratedCollection } from '@/lib/collections/catalog';
import { saverCountLabel } from '@/lib/collections/savers';
import { useCuratedSaverCount } from '@/lib/store';

export function CuratedCollectionCard({ collection, compact = false, grouped = false }: {
  collection: CuratedCollection;
  compact?: boolean;
  grouped?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const saverCount = useCuratedSaverCount(collection.id);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collection.title}, ${collection.passages.length} passages${saverCount === undefined ? '' : `, ${saverCountLabel(saverCount)}`}`}
      testID={`discover-${collection.id}`}
      onPress={() => router.push({ pathname: '/collections/[slug]', params: { slug: collection.id } })}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.tile : styles.row,
        grouped && styles.grouped,
        { backgroundColor: pressed ? colors.cardAlt : colors.card, borderColor: colors.border },
      ]}
    >
      <CollectionArt icon={collection.icon} size={compact ? 'tile' : 'thumbnail'} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{collection.title}</Text>
        {!compact && (
          <Text style={[styles.subtitle, { color: colors.icon }]}>{collection.subtitle}</Text>
        )}
        <Text style={[styles.count, { color: colors.icon }]}>{collection.passages.length} passages</Text>
        {saverCount !== undefined && (
          <Text testID={`collection-savers-${collection.id}`} style={[styles.count, { color: colors.icon }]}>
            {saverCountLabel(saverCount)}
          </Text>
        )}
      </View>
      {!compact && <IconSymbol name="chevron.right" size={16} color={colors.icon} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xxl,
    padding: 10,
    gap: 12,
  },
  tile: {
    flex: 1,
  },
  grouped: {
    borderWidth: 0,
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flexShrink: 1,
    flexGrow: 1,
    gap: 3,
  },
  title: {
    fontFamily: Fonts?.serif,
    fontSize: 19,
    fontWeight: '600',
  },
  subtitle: { fontSize: 14 },
  count: { fontSize: 13 },
});
