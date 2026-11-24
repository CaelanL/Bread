import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CuratedCollectionCard } from '@/components/collections/CuratedCollectionCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useCollectionSaversRefresh } from '@/hooks/use-collection-savers';
import { useWindowClass } from '@/hooks/use-window-class';
import { CURATED_COLLECTIONS } from '@/lib/collections/catalog';

export function ExploreCollections() {
  useCollectionSaversRefresh();
  const colors = Colors[useColorScheme() ?? 'light'];
  const openExplore = useDebouncedPress(() => router.push('/explore'));
  // The open Duo shows a row of tiles: four on its side, three upright. Elsewhere, two rows.
  const windowClass = useWindowClass();
  const tiles = windowClass === 'wide' ? 4 : windowClass === 'tall' ? 3 : 0;

  return (
    <View style={[styles.section, tiles > 0 && styles.tileSection]}>
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
      {tiles > 0 ? (
        <View style={styles.tiles}>
          {CURATED_COLLECTIONS.slice(0, tiles).map((collection) => (
            <CuratedCollectionCard key={collection.id} collection={collection} tile />
          ))}
        </View>
      ) : <View>
        {CURATED_COLLECTIONS.slice(0, 2).map((collection, index) => (
          <View key={collection.id} style={index > 0 && [styles.divided, { borderTopColor: colors.separator }]}>
            <CuratedCollectionCard collection={collection} grouped />
          </View>
        ))}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 4, gap: 4 },
  tileSection: { paddingHorizontal: 0, gap: 8, marginTop: 4 },
  tiles: { flexDirection: 'row', gap: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: 12,
  },
  title: { fontSize: 20, fontWeight: '600', flexShrink: 1 },
  seeAll: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  link: { fontSize: 14, fontWeight: '600' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
});
