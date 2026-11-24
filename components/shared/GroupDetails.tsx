import { groupProgressLabel } from '@/components/library/CollectionHeader';
import { manageMember } from '@/components/shared/member-actions';
import { InitialDot } from '@/components/shared/MemberDots';
import { MemberRow, ROLE_LABEL } from '@/components/shared/MemberRow';
import { MEMBER_STATE_LABEL, MemberStateSquare } from '@/components/shared/MemberState';
import { Colors, Radius, Shadows } from '@/constants/theme';
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
import { useAppStore, useCollection, useSharedCollection, useSynced, useVersesByCollection } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const LEGEND: MemberState[] = ['open', 'learning', 'mastered', 'engraved'];
const PAGE_SIDE = 20;
const CARD_PAD = 16;

/** Pull to refresh on Details: the collection screen's pull (sync the copy, then the library and the grid at once). */
export async function refreshSharedDetails(sharedId: string | undefined) {
  if (!sharedId) return;
  try {
    await useAppStore.getState().openSharedCollection(sharedId, { pull: true });
  } catch {
    showErrorToast("Couldn't update this shared collection. Pull to refresh to try again.");
  }
}

/**
 * A shared collection's Details (Who's where): the group's progress, every member across and every
 * verse down, one square per member per verse, then the member list. Reads the grid the collection
 * screen already fetches (`sharedProgress`). On a phone (`cards` unset) its parts sit flat on the
 * page as siblings of the page's title; on a wide window they're the setup's white cards, with Verses
 * and Members side by side when `cards.columns`.
 */
export function GroupDetails({ id, cards }: { id: string; cards?: { columns: boolean } }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const collection = useCollection(id);
  const shared = useSharedCollection(id);
  const sharedId = collection?.sharedId;
  // "Not shared" and "not in your Library" wait for the server's library: a saved one may be out of date.
  const synced = useSynced();
  const isOwner = shared?.role === 'owner';
  const ownVerses = useVersesByCollection(id);
  const { sharedProgress, grid } = useSharedGrid(sharedId, ownVerses);
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

  const retry = () => {
    if (sharedId) void useAppStore.getState().fetchSharedProgress(sharedId);
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
  // The columns scroll to the page's edge on a phone, to the card's edge on a wide window.
  const edge = cards ? CARD_PAD : PAGE_SIDE;
  const card = cards && [styles.card, { backgroundColor: colors.card }];

  if (synced && !sharedId) {
    return (
      <Text style={[styles.message, { color: colors.icon }]}>
        {collection ? "This collection isn't shared." : "This collection isn't in your Library."}
      </Text>
    );
  }
  if (!view) {
    return failed ? (
      <Pressable testID="grid-retry" accessibilityRole="button" accessibilityLabel="Couldn't load details. Retry"
        onPress={retry} style={styles.retry}>
        <Text style={[styles.message, { color: colors.text }]}>Couldn&apos;t load details.</Text>
        <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
      </Pressable>
    ) : (
      <ActivityIndicator style={styles.loading} color={colors.icon} />
    );
  }

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
      {view.rows.map((row, index) => (
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

  const title = (label: string) => cards
    ? <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{label}</Text>
    : <Text style={[styles.eyebrow, { color: colors.icon }]}>{label}</Text>;

  const sections = (
    <>
      <View style={[styles.section, cards?.columns && styles.verses]}>
        {title('Verses')}
        <View style={[styles.section, card, cards && styles.gridCard]}>
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
              style={{ marginRight: -edge }}
              contentContainerStyle={{ paddingRight: edge }}
              onLayout={(event) => setColumnsWidth(event.nativeEvent.layout.width - edge)}
            >
              {view.columns.map(renderColumn)}
            </ScrollView>
          </View>

          <View style={[styles.legend, cards && styles.legendWrap]}>
            {LEGEND.map((state) => (
              <View key={state} style={styles.legendItem}>
                <MemberStateSquare state={state} />
                <Text style={[styles.secondary, { color: colors.icon }]}>{MEMBER_STATE_LABEL[state]}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={[styles.section, cards?.columns && styles.members]}>
        {title('Members')}
        <View style={cards ? [card, styles.membersCard] : styles.section}>
          {sharedProgress?.members.map((member, index) => {
            const you = member.userId === user?.id;
            return (
              <MemberRow key={member.userId} member={member} you={you} manageable={isOwner && !you}
                last={index === sharedProgress.members.length - 1}
                disabled={busy} onPress={() => sharedId && manageMember(sharedId, member, run)} />
            );
          })}
        </View>
      </View>
    </>
  );

  return (
    <>
      {failed && (
        <Pressable testID="grid-retry" accessibilityRole="button" accessibilityLabel="Couldn't refresh details. Retry"
          onPress={retry} style={styles.staleRetry}>
          <Text style={[styles.secondary, { color: colors.icon }]}>Couldn&apos;t refresh.</Text>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      )}

      <View
        accessible
        accessibilityLabel={groupProgressLabel(progress, verseCount)}
        style={[styles.progress, cards ? [card, styles.progressCard] : styles.progressPage]}
      >
        <Text style={[styles.figure, { color: colors.text }]}>
          {percent}%
        </Text>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.success }]} />
        </View>
        <Text style={[styles.secondary, { color: colors.icon }]}>
          {progress?.masteredByEveryone ?? 0} of {verseCount} verse{verseCount === 1 ? '' : 's'} mastered by everyone
        </Text>
      </View>

      {cards?.columns ? <View style={styles.columns}>{sections}</View> : sections}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48 },
  message: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
  retry: { alignItems: 'center', gap: 6, paddingVertical: 48 },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  staleRetry: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  progress: { gap: 10 },
  progressPage: { marginTop: -8 },
  progressCard: { padding: CARD_PAD },
  figure: { fontSize: 28, lineHeight: 34, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  section: { gap: 10 },
  // Wide, side by side: the grid takes the room, the member list stays a readable width.
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 32 },
  verses: { flex: 1 },
  members: { width: 320 },
  card: { borderRadius: Radius.xxxl, boxShadow: Shadows.card },
  gridCard: { padding: CARD_PAD, gap: 16 },
  membersCard: { paddingHorizontal: CARD_PAD },
  title: { fontSize: 17, fontWeight: '600', paddingHorizontal: 2 },
  data: { fontSize: 15, lineHeight: 20 },
  secondary: { fontSize: 13, lineHeight: 18 },
  count: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  track: { height: 4, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  grid: { flexDirection: 'row' },
  references: { width: 124, marginRight: 12 },
  column: { width: GRID_PITCH, alignItems: 'center' },
  header: { height: GRID_PITCH, marginBottom: 6, alignItems: 'center', justifyContent: 'center' },
  cell: { height: GRID_PITCH, justifyContent: 'center' },
  footer: { marginTop: 6 },
  legend: { flexDirection: 'row', gap: 16 },
  legendWrap: { flexWrap: 'wrap', rowGap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
