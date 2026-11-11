import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { CollectionArt } from '@/components/collections/CollectionArt';
import { CollectionPassages } from '@/components/collections/CollectionPassages';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { CURATED_COLLECTIONS, type CuratedCollection } from '@/lib/collections/catalog';
import { curatedCollectionId } from '@/lib/collections/import';
import { BIBLE_VERSIONS, type BibleVersion } from '@/lib/settings';
import { useAppStore, useCollection, useHydrated } from '@/lib/store';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}

function CollectionIntroduction({ collection, defaultVersion }: {
  collection: CuratedCollection;
  defaultVersion: BibleVersion;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { bottom } = useSafeAreaInsets();
  const [version, setVersion] = useState(defaultVersion);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [savedPendingIds, setSavedPendingIds] = useState<string[]>([]);
  const inFlight = useRef(false);
  const focused = useRef(false);
  const collectionId = curatedCollectionId(collection.id, version);
  const savedCollection = useCollection(collectionId);
  const savedNeedsRefresh = savedPendingIds.includes(collectionId);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));

  const openCollection = () => {
    router.navigate({ pathname: '/(tabs)/(library)/[id]', params: { id: collectionId } });
  };

  const addCollection = async () => {
    if (inFlight.current) return;
    if (savedCollection && !savedNeedsRefresh) {
      openCollection();
      return;
    }

    inFlight.current = true;
    setWorking(true);
    setError(undefined);
    try {
      if (savedNeedsRefresh) {
        const { fetchCollections, fetchVerses } = useAppStore.getState();
        const loaded = await Promise.all([fetchCollections(), fetchVerses()]);
        if (!loaded.every(Boolean) || !useAppStore.getState().collections.some(({ id }) => id === collectionId)) {
          throw new Error('Could not refresh Library. Your collection was saved.');
        }
      } else {
        const result = await useAppStore.getState().importCuratedCollection(collection.id, version);
        if (!result.loaded) {
          setSavedPendingIds((ids) => [...ids, collectionId]);
          return;
        }
      }
      setSavedPendingIds((ids) => ids.filter((id) => id !== collectionId));
      if (focused.current) openCollection();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add this collection. Try again.');
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  const message = error ?? (savedNeedsRefresh ? 'Collection saved. Refresh Library to open it.' : undefined);
  const actionLabel = savedNeedsRefresh ? 'Refresh Library' : savedCollection ? 'Open collection' : 'Add collection';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} testID="collection-introduction">
        <CollectionArt icon={collection.icon} size="hero" />
        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.icon }]}>
            CURATED COLLECTION · {collection.passages.length} PASSAGES
          </Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{collection.title}</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>{collection.subtitle}</Text>
        </View>
        <View style={styles.story}>
          {collection.introduction.split('\n\n').map((paragraph) => (
            <Text key={paragraph} style={[styles.paragraph, { color: colors.text }]}>{paragraph}</Text>
          ))}
        </View>
        <CollectionPassages passages={collection.passages} version={version} />
      </ScrollView>

      <View style={[styles.footer, {
        backgroundColor: colors.card,
        borderColor: colors.border,
        paddingBottom: Math.max(12, bottom),
      }]}>
        {message && (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.text }]}>
            {message}
          </Text>
        )}
        <View style={styles.translation}>
          <Text style={[styles.versionLabel, { color: colors.icon }]}>Translation</Text>
          <View style={styles.versions}>
            {BIBLE_VERSIONS.map(({ value, label, full }) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={full}
                accessibilityState={{ selected: version === value, disabled: working }}
                testID={`curated-version-${value}`}
                style={[styles.version, {
                  backgroundColor: version === value ? colors.primaryLight : colors.cardAlt,
                  borderColor: version === value ? colors.primary : colors.border,
                }]}
                disabled={working}
                onPress={() => {
                  if (value === version) return;
                  setVersion(value);
                  setError(undefined);
                }}
              >
                <Text style={[styles.versionText, { color: colors.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: working, busy: working }}
          disabled={working}
          testID="curated-collection-action"
          style={({ pressed }) => [styles.action, {
            backgroundColor: colors.primary,
            opacity: pressed || working ? 0.75 : 1,
          }]}
          onPress={addCollection}
        >
          {working && <ActivityIndicator color={Colors.light.text} />}
          <Text style={[styles.actionText, { color: Colors.light.text }]}>
            {working ? (savedNeedsRefresh ? 'Refreshing Library…' : 'Adding collection…') : actionLabel}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

export default function CuratedCollectionScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const hydrated = useHydrated();
  const defaultVersion = useAppStore((state) => state.bibleVersion);
  const collection = CURATED_COLLECTIONS.find(({ id }) => id === slug);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader title="Collection" leftButton={{ icon: 'chevron.left', label: 'Back', onPress: goBack }} />
      {!collection ? (
        <View style={styles.empty}>
          <Text style={[styles.subtitle, { color: colors.text }]}>This collection is no longer available.</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.action}
            onPress={() => router.replace('/explore')}
          >
            <Text style={[styles.actionText, { color: colors.text }]}>Explore collections</Text>
          </Pressable>
        </View>
      ) : hydrated && user ? (
        <CollectionIntroduction
          key={`${user.id}:${collection.id}`}
          collection={collection}
          defaultVersion={defaultVersion}
        />
      ) : (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 20 },
  intro: { gap: 7 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3 },
  title: { fontFamily: Fonts?.serif, fontSize: 34, fontWeight: '600' },
  subtitle: { fontSize: 17, lineHeight: 24 },
  story: { gap: 12 },
  paragraph: { fontSize: 16, lineHeight: 25 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  translation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  versionLabel: { fontSize: 13, fontWeight: '600' },
  versions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flexShrink: 1 },
  version: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 7,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionText: { fontSize: 13, fontWeight: '600' },
  action: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  error: { fontSize: 14, lineHeight: 20 },
  empty: { padding: 20, gap: 8, alignItems: 'center' },
  loading: { flex: 1 },
});
