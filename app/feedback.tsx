import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { LargeTitle, TopBar, useTopBarHeight } from '@/components/ui/TopBar';
import { Colors, InputText, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FEEDBACK_LIMITS, newPhotoId, newReportId, sendFeedback, type FeedbackLabel, type FeedbackPhoto } from '@/lib/feedback';

const LABELS: { value: FeedbackLabel; title: string }[] = [
  { value: 'idea', title: 'Idea' },
  { value: 'bug', title: 'Bug' },
  { value: 'other', title: 'Other' },
];
const PHOTO_MB = FEEDBACK_LIMITS.photoBytes / 1024 / 1024;

/** Settings → Send feedback: a required note, an optional label, up to five photos. */
export default function FeedbackScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const barHeight = useTopBarHeight();
  const [note, setNote] = useState('');
  const [label, setLabel] = useState<FeedbackLabel | null>(null);
  const [photos, setPhotos] = useState<FeedbackPhoto[]>([]);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  // One id for this send, kept across retries, so a lost answer can't save it twice.
  const [reportId] = useState(newReportId);
  const canSend = note.trim().length > 0 && !sending;

  // The system photo picker: no photo library permission is asked for.
  const addPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: FEEDBACK_LIMITS.photos - photos.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    const fits = result.assets.filter((asset) => !asset.fileSize || asset.fileSize <= FEEDBACK_LIMITS.photoBytes);
    setPhotoNotice(fits.length < result.assets.length ? `Photos over ${PHOTO_MB} MB were left out.` : null);
    setPhotos((prev) => [...prev, ...fits.map((asset) => ({ id: newPhotoId(), uri: asset.uri, mimeType: asset.mimeType }))]
      .slice(0, FEEDBACK_LIMITS.photos));
  };

  const send = async () => {
    setSending(true);
    setError(false);
    try {
      await sendFeedback({ id: reportId, note, label, photos });
      setSent(true);
    } catch (e) {
      console.error('[FEEDBACK] Send failed:', e);
      setError(true);
    }
    setSending(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {sent ? (
        <View style={[styles.thanks, { paddingTop: barHeight }]}>
          <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
          <Text style={[styles.thanksTitle, { color: colors.text }]}>Thank you</Text>
          <Text style={[styles.copy, { color: colors.icon }]}>We read every message.</Text>
          <Pressable
            testID="feedback-done"
            accessibilityRole="button"
            style={[styles.button, styles.doneButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.buttonText, { color: colors.white }]}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.container}
          contentContainerStyle={[styles.content, { paddingTop: barHeight }]}
          keyboardShouldPersistTaps="handled"
        >
          <LargeTitle title="Send feedback" subtitle="Ideas, bugs, or anything on your mind." />

          <View style={styles.labels}>
            {LABELS.map(({ value, title }) => {
              const selected = label === value;
              return (
                <Pressable
                  key={value}
                  testID={`feedback-label-${value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setLabel(selected ? null : value)}
                  style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.cardAlt }]}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.white : colors.text }]}>{title}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            testID="feedback-note"
            style={[styles.input, { color: colors.text, backgroundColor: colors.input, borderColor: colors.border }]}
            value={note}
            onChangeText={setNote}
            placeholder="Tell us what's on your mind"
            placeholderTextColor={colors.icon}
            multiline
            maxLength={FEEDBACK_LIMITS.noteLength}
            editable={!sending}
          />

          <View style={styles.photos}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photo}>
                <Image source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  hitSlop={8}
                  disabled={sending}
                  onPress={() => setPhotos((prev) => prev.filter((p) => p.id !== photo.id))}
                  style={[styles.removePhoto, { backgroundColor: colors.overlay }]}
                >
                  <IconSymbol name="xmark" size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {photos.length < FEEDBACK_LIMITS.photos && (
              <Pressable
                testID="feedback-add-photo"
                accessibilityRole="button"
                accessibilityLabel="Add photo"
                disabled={sending}
                onPress={addPhotos}
                style={[styles.photo, styles.addPhoto, { borderColor: colors.border }]}
              >
                <IconSymbol name="photo" size={22} color={colors.icon} />
                <Text style={[styles.addPhotoText, { color: colors.icon }]}>Add photo</Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.meta, { color: colors.icon }]}>
            {photoNotice ?? `Up to ${FEEDBACK_LIMITS.photos} photos.`}
          </Text>

          {error && (
            <Text style={[styles.copy, { color: colors.error }]}>Couldn’t send. Check your connection and try again.</Text>
          )}

          <Pressable
            testID="feedback-send"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={[styles.button, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.4 }]}
          >
            {sending
              ? <ActivityIndicator color={colors.white} />
              : <Text style={[styles.buttonText, { color: colors.white }]}>Send</Text>}
          </Pressable>
        </KeyboardAwareScrollView>
      )}
      <TopBar onBack={() => router.back()} backLabel="Settings" />
    </View>
  );
}

const PHOTO_SIZE = 88;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  labels: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full },
  chipText: { fontSize: 15, fontWeight: '500' },
  input: {
    ...InputText,
    minHeight: 160,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: Radius.lg, overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  removePhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoto: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addPhotoText: { fontSize: 12 },
  meta: { fontSize: 13 },
  copy: { fontSize: 15, lineHeight: 21 },
  button: { height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  thanks: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  thanksTitle: { fontSize: 24, fontWeight: '600' },
  doneButton: { alignSelf: 'stretch', marginTop: 16 },
});
