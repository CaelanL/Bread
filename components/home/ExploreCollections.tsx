import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CuratedCollectionCard } from '@/components/collections/CuratedCollectionCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useCollectionSaversRefresh } from '@/hooks/use-collection-savers';
import { CURATED_COLLECTIONS } from '@/lib/collections/catalog';

export function ExploreCollections() {
  useCollectionSaversRefresh();
  const colors = Colors[useColorScheme() ?? 'light'];
  const { width, fontScale } = useWindowDimensions();
  const compact = width >= 350 && fontScale < 1.4;
  const openExplore = useDebouncedPress(() => router.push('/explore'));

  return (
    <View style={[styles.section, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          Explore collections
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all collections"
          testID="explore-see-all"
          onPress={openExplore}
          style={styles.seeAll}
        >
          <Text style={[styles.link, { color: colors.text }]}>See all</Text>
          <IconSymbol name="chevron.right" size={14} color={colors.icon} />
        </Pressable>
      </View>
      <View style={compact ? styles.tiles : styles.rows}>
        {CURATED_COLLECTIONS.slice(0, 2).map((collection) => (
          <CuratedCollectionCard key={collection.id} collection={collection} compact={compact} grouped />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: Radius.huge, padding: 16, gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: 12,
  },
  title: { fontSize: 21, fontWeight: '700', flexShrink: 1 },
  seeAll: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  link: { fontSize: 14, fontWeight: '600' },
  tiles: { flexDirection: 'row', gap: 12 },
  rows: { gap: 12 },
});
