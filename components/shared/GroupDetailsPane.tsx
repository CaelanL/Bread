import { GroupDetails, refreshSharedDetails } from '@/components/shared/GroupDetails';
import { CONTENT_TOP, GLASS_EDGE, PANE_PAD, SIDE, SIDE_TOP, usePaneMotion } from '@/components/study/setup/StudySetupPane';
import { GlassPill } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCollection } from '@/lib/store';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A shared collection's Details in the right pane of a wide window (the Shared-Collection board),
 * styled like study setup: the collection's name in a glass bubble, then the group's progress, Verses
 * and Members as white cards. With the list showing they stack; with it hidden Verses and Members sit
 * side by side. Moves like `StudySetupPane`. Reads the grid the collection screen fetched; a pull is
 * the collection's pull.
 */
export function GroupDetailsPane({ id, width, listWidth, collapse, collapsed, settling, buttons }: {
  id: string;
  width: number;
  listWidth: number;
  collapse: SharedValue<number>;
  collapsed: boolean;
  settling: boolean;
  buttons: number;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const collection = useCollection(id);
  const [refreshing, setRefreshing] = useState(false);
  const { pane, sideFade, wideFade, bubble } = usePaneMotion({ collapse, width, listWidth, buttons, shutCentre: width / 2 });

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshSharedDetails(collection?.sharedId, id);
    setRefreshing(false);
  };

  const layer = (columns: boolean) => {
    const top = insets.top + (columns ? CONTENT_TOP : SIDE_TOP);
    return (
      <ScrollView
        testID="group-details"
        contentContainerStyle={[styles.content, {
          paddingTop: top,
          paddingHorizontal: columns ? PANE_PAD : SIDE,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={top} />}
      >
        <GroupDetails id={id} cards={{ columns }} />
      </ScrollView>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.pane, pane]}>
        {(!collapsed || settling) && (
          <Animated.View style={[styles.layer, { width: width - listWidth }, sideFade]} pointerEvents={collapsed ? 'none' : 'auto'}>
            {layer(false)}
          </Animated.View>
        )}
        {(collapsed || settling) && (
          <Animated.View style={[styles.layer, { width }, wideFade]} pointerEvents={collapsed ? 'auto' : 'none'}>
            {layer(true)}
          </Animated.View>
        )}
      </Animated.View>

      <Animated.View pointerEvents="box-none" style={[styles.bubble, { top: insets.top + GLASS_EDGE }, bubble]}>
        <GlassPill style={styles.pill}>
          <IconSymbol name="person.2.fill" size={16} color={colors.tint} />
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Details, ${collection?.name ?? ''}`}
            numberOfLines={1}
            style={[styles.name, { color: colors.text }]}
          >
            {collection?.name}
          </Text>
        </GlassPill>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  layer: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  bubble: { position: 'absolute', alignItems: 'center', zIndex: 2 },
  content: { gap: 24 },
  pill: { maxWidth: '100%', paddingLeft: 14, paddingRight: 16 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
