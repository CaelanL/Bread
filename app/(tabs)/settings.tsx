import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
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
            backgroundColor: colors.card,
            borderColor: colors.borderLight,
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
        { borderBottomColor: colors.borderLight },
      ]}
    >
      <View style={styles.rowLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.cardAlt },
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

interface ColorModePickerProps {
  value: ColorMode;
  onChange: (value: ColorMode) => void;
}

function ColorModePicker({ value, onChange }: ColorModePickerProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
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
                backgroundColor: isSelected ? colors.primary : colors.cardAlt,
              },
            ]}
            onPress={() => onChange(mode.value)}
          >
            <Text
              style={[
                styles.pickerOptionText,
                { color: isSelected ? colors.white : isDark ? colors.white : colors.text },
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
  const [versionPickerVisible, setVersionPickerVisible] = React.useState(false);
  const [copyrightVisible, setCopyrightVisible] = React.useState(false);

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
          <Pressable onPress={() => setVersionPickerVisible(true)}>
            <SettingsRow
              icon="book.fill"
              label="Default Translation"
              description="Used when adding new verses"
            >
              <View style={styles.dropdownTrigger}>
                <Text style={[styles.dropdownValue, { color: colors.text }]}>
                  {selectedVersion?.label}
                </Text>
                <IconSymbol name="chevron.right" size={16} color={colors.icon} />
              </View>
            </SettingsRow>
          </Pressable>
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
                    { backgroundColor: colors.cardAlt },
                  ]}
                >
                  <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color={colors.error} />
                </View>
                <View style={styles.labelContainer}>
                  <Text style={[styles.label, { color: colors.error }]}>Sign Out</Text>
                </View>
              </View>
              {signingOut && <ActivityIndicator size="small" color={colors.error} />}
            </View>
          </Pressable>
        </SettingsSection>

        {/* About */}
        <SettingsSection title="ABOUT">
          <SettingsRow icon="info.circle.fill" label="Version" description="1.0.0" />
          <Pressable onPress={() => setCopyrightVisible(true)}>
            <SettingsRow
              icon="doc.text.fill"
              label="Copyrights"
              description="Bible translation notices"
            >
              <IconSymbol name="chevron.right" size={16} color={colors.icon} />
            </SettingsRow>
          </Pressable>
        </SettingsSection>
      </ScrollView>

      {/* Version Picker Modal */}
      <Modal visible={versionPickerVisible} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setVersionPickerVisible(false)}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Translation</Text>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {BIBLE_VERSIONS.map((version) => {
                const isSelected = bibleVersion === version.value;
                return (
                  <Pressable
                    key={version.value}
                    style={[
                      styles.modalOption,
                      isSelected && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => {
                      setBibleVersion(version.value);
                      setVersionPickerVisible(false);
                    }}
                  >
                    <Text style={[styles.modalOptionLabel, { color: isSelected ? colors.white : colors.text }]}>
                      {version.label}
                    </Text>
                    <Text style={[styles.modalOptionDesc, { color: isSelected ? 'rgba(255,255,255,0.7)' : colors.icon }]}>
                      {version.full}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Copyright Modal */}
      <Modal visible={copyrightVisible} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setCopyrightVisible(false)}
        >
          <View
            style={[styles.copyrightModal, { backgroundColor: colors.cardAlt }]}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView style={styles.copyrightScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.copyrightItem}>
                <Text style={[styles.copyrightVersion, { color: colors.text }]}>ESV</Text>
                <Text style={[styles.copyrightText, { color: colors.icon }]}>
                  Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.
                </Text>
              </View>
              <View style={[styles.copyrightItem, styles.copyrightItemLast]}>
                <Text style={[styles.copyrightVersion, { color: colors.text }]}>NLT</Text>
                <Text style={[styles.copyrightText, { color: colors.icon }]}>
                  Scripture quotations are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.
                </Text>
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dropdownValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    maxHeight: '60%',
    borderRadius: 16,
    padding: 16,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalOption: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  modalOptionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalOptionDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  copyrightModal: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: 16,
    padding: 16,
  },
  copyrightScroll: {
    flexGrow: 0,
  },
  copyrightItem: {
    marginBottom: 16,
  },
  copyrightItemLast: {
    marginBottom: 0,
  },
  copyrightVersion: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  copyrightText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
