import { MemberDots } from '@/components/shared/MemberDots';
import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTopBarHeight } from '@/components/ui/TopBar';
import { AccentAlpha, Colors, Radius, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Emblem } from '@/lib/shared/progress';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type IconName = ComponentProps<typeof IconSymbol>['name'];

// The wash runs this far below the bar, and stays solid this far above it for a pull to refresh.
const WASH = 220;
const OVERSCROLL = 400;

/** "Group progress 50%. 1 of 3 verses mastered by everyone", or the loading label. */
export function groupProgressLabel(progress: { ratio: number; masteredByEveryone: number } | null, verseCount: number): string {
  if (!progress) return 'Group progress loading';
  if (verseCount === 0) return 'Group progress. No verses yet';
  return `Group progress ${Math.round(progress.ratio * 100)}%. ${progress.masteredByEveryone} of ${verseCount} verse${verseCount === 1 ? '' : 's'} mastered by everyone`;
}

/**
 * The top of a collection's screen, in its content: the collection's accent washing down from the
 * top edge, the icon, the name, then who it's with (or the verse count), the group's progress and
 * the screen's actions as pills. `onTitleBottom` reports where the name ends, for the bar's title.
 */
export function CollectionHeader({
  symbol,
  accent,
  emblem,
  iconLabel,
  onIconPress,
  name,
  onTitleBottom,
  people,
  subtitle,
  invite,
  progress,
  children,
}: {
  symbol: IconName;
  /** A hex colour: the brand's, or the collection's own (Mastered, In Progress). */
  accent: string;
  emblem: Emblem | null;
  iconLabel: string;
  onIconPress?: () => void;
  name: string;
  onTitleBottom: (y: number) => void;
  /** Shared with others: initials (null until read) and the line beside them. */
  people?: { members: { name: string; you: boolean }[] | null; count: number; line: string; onPress: () => void };
  subtitle?: string;
  invite?: ReactNode;
  progress?: { ratio: number | null; label: string; failed: boolean; onPress: () => void; onRetry: () => void };
  /** The pills row. */
  children?: ReactNode;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const barHeight = useTopBarHeight();
  const engraved = emblem === 'engraved';
  const percent = progress?.ratio == null ? 0 : Math.round(progress.ratio * 100);
  const washTop = barHeight + OVERSCROLL;

  const icon = (
    <View style={[styles.icon, { backgroundColor: engraved ? colors.engravedFill : withAlpha(accent, AccentAlpha.fill) }]}>
      <IconSymbol name={symbol} size={28} color={engraved ? colors.tint : accent} />
    </View>
  );

  return (
    <View style={styles.header}>
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(accent, AccentAlpha.wash), withAlpha(accent, 0)]}
        locations={[OVERSCROLL / (washTop + WASH), 1]}
        style={[styles.wash, { top: -washTop, height: washTop + WASH }]}
      />
      {onIconPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={iconLabel} onPress={onIconPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          {icon}
        </Pressable>
      ) : icon}

      <Text
        accessibilityRole="header"
        style={[styles.name, { color: colors.text }]}
        onLayout={(event) => onTitleBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)}
      >
        {name}
      </Text>

      {people ? (
        <Pressable testID="shared-row" accessibilityRole="button" accessibilityLabel={`${people.line}. Show members`} onPress={people.onPress}
          style={({ pressed }) => [styles.meta, pressed && styles.pressed]}>
          {people.members && <MemberDots members={people.members} count={people.count} surface={colors.background} />}
          <Text style={[styles.metaText, { color: colors.icon }]} numberOfLines={1}>{people.line}</Text>
        </Pressable>
      ) : subtitle ? (
        <View style={styles.meta}>
          {emblem === 'mastered' && <IconSymbol name="checkmark" size={14} color={colors.success} />}
          {engraved && <EngravedIcon size={14} color={colors.tint} />}
          <Text style={[styles.metaText, { color: colors.icon }]} numberOfLines={1}>{subtitle}</Text>
        </View>
      ) : null}

      {invite && <View style={styles.invite}>{invite}</View>}

      {progress && (
        <Pressable
          testID={progress.failed ? 'shared-progress-retry' : 'shared-progress'}
          accessibilityRole="button"
          accessibilityLabel={progress.failed ? "Couldn't load group progress. Retry" : progress.label}
          accessibilityHint={progress.failed ? undefined : 'Shows details'}
          onPress={progress.failed ? progress.onRetry : progress.onPress}
          style={({ pressed }) => [styles.progress, pressed && styles.pressed]}
        >
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.success }]} />
          </View>
          {progress.failed ? (
            <Text style={[styles.progressText, { color: colors.primary }]}>Couldn&apos;t load · Retry</Text>
          ) : (
            <Text style={[styles.progressText, { color: colors.icon }]}>
              {progress.ratio == null ? '–' : `${percent}%`} together
            </Text>
          )}
          <IconSymbol name="chevron.right" size={12} color={colors.icon} />
        </Pressable>
      )}

      {children && <View style={styles.pills}>{children}</View>}
    </View>
  );
}

/** A small action under the header. `primary` is the screen's one accent action. */
export function HeaderPill({ ref, icon, label, onPress, primary, testID, accessibilityLabel, hidden }: {
  ref?: Ref<View>;
  icon: IconName;
  label?: string;
  onPress: () => void;
  primary?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  /** Kept in place but invisible, while a search grown out of it is open. */
  hidden?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        !label && styles.iconPill,
        { backgroundColor: primary ? colors.primaryLight : colors.fill },
        pressed && styles.pressed,
        hidden && styles.hidden,
      ]}
    >
      <IconSymbol name={icon} size={14} color={primary ? colors.tint : colors.icon} />
      {label && <Text style={[styles.pillText, { color: primary ? colors.tint : colors.text }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  wash: { position: 'absolute', left: 0, right: 0 },
  iconButton: { alignSelf: 'flex-start' },
  icon: { width: 56, height: 56, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 14, fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 },
  meta: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%' },
  metaText: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
  invite: { marginTop: 8 },
  progress: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  track: { flex: 1, height: 4, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  progressText: { fontSize: 13, lineHeight: 18, fontWeight: '500', fontVariant: ['tabular-nums'] },
  pills: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: Radius.full },
  iconPill: { width: 32, paddingHorizontal: 0, justifyContent: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.6 },
  hidden: { opacity: 0 },
});
