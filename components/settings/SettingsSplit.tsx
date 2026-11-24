import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { RAIL_TITLE_TOP } from '@/components/ui/TabRail';
import { LargeTitle } from '@/components/ui/TopBar';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const TOPICS = ['feedback', 'translation', 'appearance', 'review', 'notifications', 'account', 'about'] as const;
export type SettingsTopic = (typeof TOPICS)[number];

export function isSettingsTopic(value: string | undefined): value is SettingsTopic {
  return TOPICS.some((topic) => topic === value);
}

export type TopicRow = {
  topic: SettingsTopic;
  icon: ComponentProps<typeof IconSymbol>['name'];
  label: string;
  /** Shown at the row's end; `strong` draws it in the text colour, like the translation. */
  value?: string;
  strong?: boolean;
  /** A second line under the label (the account's email). */
  detail?: string;
};

// The Settings board: a 340 pt list beside the chosen section, both starting under the safe top.
const LIST_WIDTH = 340;
const PANE_TOP = 30;
const PANE_SIDE = 32;
const PANE_BOTTOM = 24;

/** Settings' left column on a wide window: the title and grouped topic rows, the chosen one highlighted. */
export function SettingsList({ groups, selected, onSelect }: {
  groups: TopicRow[][];
  selected: SettingsTopic;
  onSelect: (topic: SettingsTopic) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[styles.list, { backgroundColor: colors.cardAlt, borderRightColor: colors.border }]}
      contentContainerStyle={[styles.listContent, { paddingTop: insets.top + RAIL_TITLE_TOP, paddingBottom: insets.bottom + PANE_BOTTOM }]}
    >
      <View style={styles.listTitle}><LargeTitle root title="Settings" /></View>
      {groups.map((rows) => (
        <View key={rows[0].topic} style={[styles.group, { backgroundColor: colors.card, borderColor: colors.borderLight }]}>
          {rows.map((row, index) => {
            const isSelected = row.topic === selected;
            return (
              <Pressable
                key={row.topic}
                testID={`settings-topic-${row.topic}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(row.topic)}
                style={[
                  styles.row,
                  index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
                  isSelected && { backgroundColor: colors.primaryLight },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: isSelected ? colors.card : colors.cardAlt }]}>
                  <IconSymbol name={row.icon} size={18} color={colors.tint} />
                </View>
                <View style={styles.label}>
                  <Text style={[styles.labelText, isSelected && styles.labelSelected, { color: colors.text }]}>{row.label}</Text>
                  {row.detail && <Text style={[styles.detail, { color: colors.icon }]} numberOfLines={1}>{row.detail}</Text>}
                </View>
                {row.value && (
                  <Text style={[styles.value, { color: row.strong ? colors.text : colors.icon }, row.strong && styles.valueStrong]}>{row.value}</Text>
                )}
                <IconSymbol name="chevron.right" size={14} color={colors.icon} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

/** Padding for a pane's scroll content, for panes that bring their own scroll view (notifications, feedback). */
export function usePaneContentStyle() {
  const insets = useSafeAreaInsets();
  return { paddingTop: insets.top + PANE_TOP, paddingHorizontal: PANE_SIDE, paddingBottom: insets.bottom + PANE_BOTTOM };
}

/** The chosen section beside the list: its title, then its cards. */
export function SettingsPane({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const contentStyle = usePaneContentStyle();
  return (
    <ScrollView contentContainerStyle={[styles.paneContent, contentStyle]}>
      <LargeTitle title={title} subtitle={subtitle} />
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, width: LIST_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  listContent: { paddingLeft: 20, paddingRight: 16, gap: 18 },
  listTitle: { marginLeft: 4, marginBottom: 2 },
  group: { borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12 },
  icon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0 },
  labelText: { fontSize: 16, fontWeight: '500' },
  labelSelected: { fontWeight: '600' },
  detail: { fontSize: 13 },
  value: { fontSize: 15 },
  valueStrong: { fontWeight: '500' },
  paneContent: { gap: 22 },
});
