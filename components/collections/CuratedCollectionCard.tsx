import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionArt } from '@/components/collections/CollectionArt';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import type { CuratedCollection } from '@/lib/collections/catalog';
import { saverCountLabel } from '@/lib/collections/savers';
import { useCuratedSaverCount } from '@/lib/store';

const lastCardPress = { current: 0 };

export function CuratedCollectionCard({ collection, grouped = false }: {
  collection: CuratedCollection;
  grouped?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const saverCount = useCuratedSaverCount(collection.id);
  const handlePress = useDebouncedPress(
    () => router.push({ pathname: '/collections/[slug]', params: { slug: collection.id } }),
    undefined,
    lastCardPress,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[collection.title, `${collection.passages.length} passages`, saverCountLabel(saverCount ?? 0)].filter(Boolean).join(', ')}
      testID={`discover-${collection.id}`}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        styles.row,
        grouped && styles.grouped,
        grouped
          ? pressed && styles.pressed
          : { backgroundColor: pressed ? colors.cardAlt : colors.card, borderColor: colors.border },
      ]}
    >
      <CollectionArt icon={collection.icon} size="thumbnail" />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{collection.title}</Text>
        <Text style={[styles.subtitle, { color: colors.icon }]}>{collection.subtitle}</Text>
        <Text style={[styles.count, { color: colors.icon }]}>{collection.passages.length} passages</Text>
        {!!saverCountLabel(saverCount ?? 0) && (
          <Text testID={`collection-savers-${collection.id}`} style={[styles.count, { color: colors.icon }]}>
            {saverCountLabel(saverCount ?? 0)}
          </Text>
        )}
      </View>
      <IconSymbol name="chevron.right" size={16} color={colors.icon} />
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
  // Flat in a list on the page, with the list's own hairlines.
  grouped: {
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
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
