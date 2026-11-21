import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CuratedCollectionCard } from '@/components/collections/CuratedCollectionCard';
import { TopBar, useTopBarHeight } from '@/components/ui/TopBar';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCollectionSaversRefresh } from '@/hooks/use-collection-savers';
import { CURATED_COLLECTIONS } from '@/lib/collections/catalog';

export default function ExploreScreen() {
  useCollectionSaversRefresh();
  const colors = Colors[useColorScheme() ?? 'light'];
  const barHeight = useTopBarHeight();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <TopBar onBack={() => router.back()} backLabel="Back to Home" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: barHeight + 8 }]}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            Explore collections
          </Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            Find a theme and start with one passage.
          </Text>
        </View>
        {CURATED_COLLECTIONS.map((collection) => (
          <CuratedCollectionCard key={collection.id} collection={collection} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 28, gap: 12 },
  intro: { gap: 8, marginBottom: 8 },
  title: { fontFamily: Fonts?.serif, fontSize: 34, fontWeight: '600' },
  subtitle: { fontSize: 16 },
});
