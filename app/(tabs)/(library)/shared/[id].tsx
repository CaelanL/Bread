import { GroupDetails, refreshSharedDetails } from '@/components/shared/GroupDetails';
import { LargeTitle, TopBar, useTopBarHeight } from '@/components/ui/TopBar';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';
import { useAppStore, useCollection } from '@/lib/store';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

/**
 * Who's where, pushed on a phone: `GroupDetails` under a large "Details" title. On a wide window the
 * collection screen shows the same details in its right pane, so this page goes back to it.
 */
export default function WhoIsWhereScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const colors = Colors[useColorScheme() ?? 'light'];
  const collection = useCollection(id || '');
  const sharedId = collection?.sharedId;
  const [refreshing, setRefreshing] = useState(false);
  const barHeight = useTopBarHeight();
  const wide = useWindowClass() === 'wide';

  // A fresh read each visit; the collection screen under this one already synced the copy.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (wide || !sharedId || fetchedFor.current === sharedId) return;
    fetchedFor.current = sharedId;
    void useAppStore.getState().fetchSharedProgress(sharedId);
  }, [sharedId, wide]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshSharedDetails(sharedId, id || '');
    setRefreshing(false);
  };

  const back = () => {
    if ((navigation.getState()?.index ?? 0) > 0) router.back();
    else router.replace(`/(tabs)/(library)/${id}`);
  };

  // On a wide window (an unfold with this page open, or a link) the collection shows Details beside its list.
  useEffect(() => {
    if (wide) back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);
  if (wide) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.ScrollView
        testID="whos-where"
        contentContainerStyle={[styles.content, { paddingTop: barHeight }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={barHeight} />}
      >
        <LargeTitle title="Details" subtitle={collection?.name} />
        <GroupDetails id={id || ''} />
      </Animated.ScrollView>
      <TopBar onBack={back} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 28 },
});
