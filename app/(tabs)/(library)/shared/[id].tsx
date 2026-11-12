import { AppHeader } from '@/components/app-header';
import { groupProgressLabel } from '@/components/shared/SharedStrip';
import { manageMember } from '@/components/shared/member-actions';
import { InitialDot } from '@/components/shared/MemberDots';
import { MemberRow, ROLE_LABEL } from '@/components/shared/MemberRow';
import { MEMBER_STATE_LABEL, MemberStateSquare } from '@/components/shared/MemberState';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSharedGrid } from '@/hooks/use-shared-grid';
import { useAuth } from '@/lib/auth';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import {
  groupProgress,
  GRID_PITCH,
  gridScrolls,
  masteredByEveryoneCount,
  whoIsWhere,
  type GridColumn,
  type MemberState,
} from '@/lib/shared/progress';
import { formatVerseReference } from '@/lib/storage';
import { useAppStore, useCollection, useHydrated, useSharedCollection, useVersesByCollection } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

const LEGEND: MemberState[] = ['open', 'learning', 'mastered', 'engraved'];

/**
 * Who's where: every member across, every verse down, one square per member per verse, then the
 * member list. Reads the grid the collection screen already fetches (`sharedProgress`).
 */
export default function WhoIsWhereScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const colors = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const collection = useCollection(id || '');
  const shared = useSharedCollection(id || '');
  const sharedId = collection?.sharedId;
  const hydrated = useHydrated();
  const isOwner = shared?.role === 'owner';
  const ownVerses = useVersesByCollection(id || '');
  const { sharedProgress, grid } = useSharedGrid(sharedId, ownVerses);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [columnsWidth, setColumnsWidth] = useState(0);

  const view = useMemo(
    () => (grid && sharedProgress ? whoIsWhere(grid, sharedProgress.members, user?.id) : null),
    [grid, sharedProgress, user],
  );
  const progress = useMemo(
    () => (grid ? { ratio: groupProgress(grid), masteredByEveryone: masteredByEveryoneCount(grid) } : null),
    [grid],
  );

  // A fresh read each visit; the collection screen under this one already synced the copy.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sharedId || fetchedFor.current === sharedId) return;
    fetchedFor.current = sharedId;
    void useAppStore.getState().fetchSharedProgress(sharedId);
  }, [sharedId]);

  // The same as pulling on the collection screen: refresh, sync the copy, read the grid.
  const onRefresh = async () => {
    setRefreshing(true);
    await useAppStore.getState().refresh();
    if (sharedId) {
      try {
        await useAppStore.getState().openSharedCollection(sharedId);
      } catch {
        showErrorToast("Couldn't update this shared collection. Pull to refresh to try again.");
      }
    }
    setRefreshing(false);
  };

  const retry = () => {
    if (sharedId) void useAppStore.getState().fetchSharedProgress(sharedId);
  };

  const back = () => {
    if ((navigation.getState()?.index ?? 0) > 0) router.back();
    else router.replace(`/(tabs)/(library)/${id}`);
  };

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      showErrorToast(sharedErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const failed = sharedProgress?.failed ?? false;
  const verseCount = view?.rows.length ?? 0;
  const scrolls = gridScrolls(view?.columns.length ?? 0, columnsWidth);
  const percent = progress ? Math.round(progress.ratio * 100) : 0;

  // Fixed-pitch columns, yours first with the solid circle. Tiles don't press: the grid only shows.
  const renderColumn = (column: GridColumn) => (
    <View key={column.userId} style={styles.column}>
      <View
        accessible
        accessibilityLabel={`${column.you ? 'You' : column.displayName}, ${ROLE_LABEL[column.role]}, ${column.masteredCount} of ${verseCount} mastered`}
        style={styles.header}
      >
        <InitialDot name={column.displayName} you={column.you} />
      </View>
      {view?.rows.map((row, index) => (
        <View key={row.key} style={styles.cell}>
          <MemberStateSquare
            state={column.states[index]}
            label={`${column.you ? 'You' : column.displayName}, ${formatVerseReference(row.reference)}`}
          />
        </View>
      ))}
      {verseCount > 0 && (
        <View style={[styles.cell, styles.footer]}>
          <Text style={[styles.count, { color: colors.icon }]}>{column.masteredCount}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Details" leftButton={{ icon: 'chevron.left', label: 'Back', onPress: back }} />
      <ScrollView
        testID="whos-where"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />}
      >
        {hydrated && !sharedId ? (
          <Text style={[styles.message, { color: colors.icon }]}>
            {collection ? "This collection isn't shared." : "This collection isn't in your Library."}
          </Text>
        ) : !view ? (
          failed ? (
            <Pressable testID="grid-retry" accessibilityRole="button" accessibilityLabel="Couldn't load details. Retry"
              onPress={retry} style={styles.retry}>
              <Text style={[styles.message, { color: colors.text }]}>Couldn&apos;t load details.</Text>
              <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
            </Pressable>
          ) : (
            <ActivityIndicator style={styles.loading} color={colors.icon} />
          )
        ) : (
          <>
            {failed && (
              <Pressable testID="grid-retry" accessibilityRole="button" accessibilityLabel="Couldn't refresh details. Retry"
                onPress={retry} style={styles.staleRetry}>
                <Text style={[styles.secondary, { color: colors.icon }]}>Couldn&apos;t refresh.</Text>
                <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
              </Pressable>
            )}

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View accessible accessibilityLabel={groupProgressLabel(progress, verseCount)} style={styles.progress}>
                <View style={styles.progressTop}>
                  <Text style={[styles.data, { color: colors.text }]}>Group progress</Text>
                  <Text style={[styles.data, styles.figure, { color: colors.text }]}>{percent}%</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.borderLight }]}>
                  <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.success }]} />
                </View>
                <Text style={[styles.secondary, { color: colors.icon }]}>
                  {progress?.masteredByEveryone ?? 0} of {verseCount} verse{verseCount === 1 ? '' : 's'} mastered by everyone
                </Text>
              </View>

              <View style={styles.grid}>
                <View style={styles.references}>
                  <View style={styles.header} />
                  {view.rows.map((row) => (
                    <View key={row.key} style={styles.cell}>
                      <Text style={[styles.data, { color: colors.text }]} numberOfLines={1}>
                        {formatVerseReference(row.reference)}
                      </Text>
                    </View>
                  ))}
                  {verseCount > 0 ? (
                    <View style={[styles.cell, styles.footer]}>
                      <Text style={[styles.secondary, { color: colors.icon }]}>Mastered</Text>
                    </View>
                  ) : (
                    <Text style={[styles.secondary, { color: colors.icon }]}>No verses yet</Text>
                  )}
                </View>
                <ScrollView
                  horizontal
                  scrollEnabled={scrolls}
                  showsHorizontalScrollIndicator={false}
                  style={styles.columns}
                  contentContainerStyle={styles.columnsContent}
                  onLayout={(event) => setColumnsWidth(event.nativeEvent.layout.width - CARD_PADDING)}
                >
                  {view.columns.map(renderColumn)}
                </ScrollView>
              </View>

              <View style={styles.legend}>
                {LEGEND.map((state) => (
                  <View key={state} style={styles.legendItem}>
                    <MemberStateSquare state={state} />
                    <Text style={[styles.secondary, { color: colors.icon }]}>{MEMBER_STATE_LABEL[state]}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View>
              <Text style={[styles.eyebrow, { color: colors.icon }]}>Members</Text>
              {sharedProgress?.members.map((member) => {
                const you = member.userId === user?.id;
                return (
                  <MemberRow key={member.userId} member={member} you={you} manageable={isOwner && !you}
                    disabled={busy} onPress={() => sharedId && manageMember(sharedId, member, run)} />
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const CARD_PADDING = 14;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 16 },
  loading: { paddingVertical: 48 },
  message: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
  retry: { alignItems: 'center', gap: 6, paddingVertical: 48 },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  staleRetry: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  // The strip's card.
  card: { borderRadius: Radius.xxl, borderWidth: 1, paddingHorizontal: CARD_PADDING, paddingVertical: 12, gap: 16 },
  progress: { gap: 8 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  data: { fontSize: 15, lineHeight: 20 },
  figure: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  secondary: { fontSize: 13, lineHeight: 18 },
  count: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  grid: { flexDirection: 'row' },
  references: { width: 124, marginRight: 12 },
  // The columns scroll to the card's edge, so a column cut by scrolling is cut at the border.
  columns: { marginRight: -CARD_PADDING },
  columnsContent: { paddingRight: CARD_PADDING },
  column: { width: GRID_PITCH, alignItems: 'center' },
  header: { height: GRID_PITCH, marginBottom: 6, alignItems: 'center', justifyContent: 'center' },
  cell: { height: GRID_PITCH, justifyContent: 'center' },
  footer: { marginTop: 6 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
