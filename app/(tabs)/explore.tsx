import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { CuratedCollectionCard } from '@/components/collections/CuratedCollectionCard';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CURATED_COLLECTIONS } from '@/lib/collections/catalog';

export default function ExploreScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader leftButton={{ icon: 'chevron.left', label: 'Back to Home', onPress: () => router.navigate('/home') }} />
      <ScrollView contentContainerStyle={styles.content}>
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
