import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionArt } from '@/components/collections/CollectionArt';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { CuratedCollection } from '@/lib/collections/catalog';

export function CuratedCollectionCard({ collection, compact = false }: {
  collection: CuratedCollection;
  compact?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collection.title}, ${collection.passages.length} passages`}
      testID={`discover-${collection.id}`}
      onPress={() => router.push({ pathname: '/collections/[slug]', params: { slug: collection.id } })}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.tile : styles.row,
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
