import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BIBLE_VERSIONS, COLOR_MODES, type BibleVersion } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { useAppStore } from '@/lib/store';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.icon }]}>{title}</Text>
      <View
        style={[
          styles.sectionContent,
          {
            backgroundColor: colorScheme === 'dark' ? '#1c1c1e' : '#fff',
            borderColor: colorScheme === 'dark' ? '#38383a' : '#e5e5e5',
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

interface SettingsRowProps {
  icon: string;
  label: string;
  description?: string;
  children?: React.ReactNode;
}

function SettingsRow({ icon, label, description, children }: SettingsRowProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: isDark ? '#38383a' : '#e5e5e5' },
      ]}
    >
      <View style={styles.rowLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' },
          ]}
        >
          <IconSymbol name={icon as any} size={20} color={colors.tint} />
        </View>
        <View style={styles.labelContainer}>
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
          {description && (
            <Text style={[styles.description, { color: colors.icon }]}>
              {description}
            </Text>
          )}
        </View>
      </View>
      {children}
    </View>
  );
}

interface VersionPickerProps {
  value: BibleVersion;
  onChange: (value: BibleVersion) => void;
}

function VersionPicker({ value, onChange }: VersionPickerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={styles.picker}>
      {BIBLE_VERSIONS.map((version) => {
        const isSelected = value === version.value;
        return (
          <Pressable
            key={version.value}
            style={[
              styles.pickerOption,
              {
                backgroundColor: isSelected
                  ? isDark
                    ? '#0a84ff'
                    : '#007aff'
                  : isDark
                  ? '#3a3a3c'
                  : '#e5e5ea',
              },
            ]}
            onPress={() => onChange(version.value)}
          >
            <Text
              style={[
                styles.pickerOptionText,
                { color: isSelected ? '#fff' : isDark ? '#fff' : '#000' },
              ]}
            >
              {version.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ColorModePickerProps {
  value: ColorMode;
  onChange: (value: ColorMode) => void;
}

function ColorModePicker({ value, onChange }: ColorModePickerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={styles.picker}>
      {COLOR_MODES.map((mode) => {
        const isSelected = value === mode.value;
        return (
          <Pressable
            key={mode.value}
            style={[
              styles.pickerOption,
              {
                backgroundColor: isSelected
                  ? isDark
                    ? '#0a84ff'
                    : '#007aff'
                  : isDark
                  ? '#3a3a3c'
                  : '#e5e5ea',
              },
            ]}
            onPress={() => onChange(mode.value)}
          >
            <Text
              style={[
                styles.pickerOptionText,
                { color: isSelected ? '#fff' : isDark ? '#fff' : '#000' },
              ]}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const hydrated = useAppStore((state) => state.hydrated);
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const bibleVersion = useAppStore((state) => state.bibleVersion);
  const setBibleVersion = useAppStore((state) => state.setBibleVersion);
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  };

  const selectedVersion = BIBLE_VERSIONS.find(
    (v) => v.value === bibleVersion
  );

  if (!hydrated) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Bible Settings */}
        <SettingsSection title="BIBLE">
          <SettingsRow
            icon="book.fill"
            label="Default Translation"
            description={`${selectedVersion?.full} • Used when adding new verses`}
          >
            <VersionPicker
              value={bibleVersion}
              onChange={setBibleVersion}
            />
          </SettingsRow>
        </SettingsSection>

        {/* Appearance */}
        <SettingsSection title="APPEARANCE">
          <SettingsRow
            icon="moon.fill"
            label="Theme"
            description="Choose light, dark, or follow system"
          >
            <ColorModePicker
              value={colorMode}
              onChange={setColorMode}
            />
          </SettingsRow>
        </SettingsSection>

        {/* Account */}
        <SettingsSection title="ACCOUNT">
          <SettingsRow
            icon="person.fill"
            label="Email"
            description={user?.email ?? 'Not signed in'}
          />
          <Pressable onPress={handleSignOut} disabled={signingOut}>
            <View
              style={[
                styles.row,
                { borderBottomWidth: 0 },
              ]}
            >
              <View style={styles.rowLeft}>
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' },
                  ]}
                >
                  <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color="#ef4444" />
                </View>
                <View style={styles.labelContainer}>
                  <Text style={[styles.label, { color: '#ef4444' }]}>Sign Out</Text>
                </View>
              </View>
              {signingOut && <ActivityIndicator size="small" color="#ef4444" />}
            </View>
          </Pressable>
        </SettingsSection>

        {/* About */}
        <SettingsSection title="ABOUT">
          <SettingsRow icon="info.circle.fill" label="Version" description="1.0.0" />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginLeft: 16,
  },
  sectionContent: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
  picker: {
    flexDirection: 'row',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pickerOptionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
