// lib-ok: Feedback writes (grading reports, Settings feedback and its photos) and their limits.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { sessionUserId, supabase } from '@/lib/api/client';
import type { GradingReport } from './grading-report';
import { saveReport, saveReportWithPhotos } from './save';

export { newPhotoId, newReportId } from './save';

/** The migration enforces the same numbers (table checks and the bucket). */
export const FEEDBACK_LIMITS = { noteLength: 4000, photos: 5, photoBytes: 50 * 1024 * 1024 } as const;

export type FeedbackLabel = 'idea' | 'bug' | 'other';

export interface FeedbackPhoto {
  /** From `newPhotoId()` when picked; the photo's path comes from it. */
  id: string;
  uri: string;
  mimeType?: string;
}

function withDevice(row: { id: string } & Record<string, unknown>) {
  return {
    ...row,
    app_version: Constants.expoConfig?.version ?? null,
    update_id: Updates.updateId ?? null,
    os: Platform.OS,
    os_version: String(Platform.Version),
    device_model: Device.modelName ?? null,
  };
}

/** `id` stays the same across retries of one result's report. */
export function sendGradingReport(id: string, details: GradingReport, note: string): Promise<void> {
  return saveReport(supabase, withDevice({ id, kind: 'grading', note: note.trim(), details }));
}

/** Uploads the photos into the reader's folder, then saves the report. `id` and each photo's id stay the same across retries. */
export async function sendFeedback({ id, note, label, photos }: {
  id: string;
  note: string;
  label: FeedbackLabel | null;
  photos: FeedbackPhoto[];
}): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) throw new Error('Not signed in');
  await saveReportWithPhotos(supabase, userId, withDevice({ id, kind: 'general', label, note: note.trim() }),
    photos.map((photo) => ({
      id: photo.id,
      contentType: photo.mimeType ?? 'image/jpeg',
      read: () => new File(photo.uri).arrayBuffer(),
    })));
}
