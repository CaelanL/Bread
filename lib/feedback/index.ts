// lib-ok: Feedback writes (grading reports, Settings feedback and its photos) and their limits.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { sessionUserId, supabase } from '@/lib/api/client';
import type { GradingReport } from './grading-report';
import { saveReport, uploadPhoto } from './save';

export { newReportId } from './save';

/** The migration enforces the same numbers (table checks and the bucket). */
export const FEEDBACK_LIMITS = { noteLength: 4000, photos: 3, photoBytes: 5 * 1024 * 1024 } as const;

export type FeedbackLabel = 'idea' | 'bug' | 'other';

export interface FeedbackPhoto {
  uri: string;
  mimeType?: string;
}

function insertReport(row: { id: string } & Record<string, unknown>): Promise<void> {
  return saveReport(supabase, {
    ...row,
    app_version: Constants.expoConfig?.version ?? null,
    update_id: Updates.updateId ?? null,
    os: Platform.OS,
    os_version: String(Platform.Version),
    device_model: Device.modelName ?? null,
  });
}

/** `id` stays the same across retries of one result's report. */
export function sendGradingReport(id: string, details: GradingReport, note: string): Promise<void> {
  return insertReport({ id, kind: 'grading', note: note.trim(), details });
}

/** Uploads the photos into the reader's folder, then saves the report. Paths come from `id`, so a retry reuses what landed. */
export async function sendFeedback({ id, note, label, photos }: {
  id: string;
  note: string;
  label: FeedbackLabel | null;
  photos: FeedbackPhoto[];
}): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) throw new Error('Not signed in');
  const paths: string[] = [];
  for (const photo of photos) {
    const contentType = photo.mimeType ?? 'image/jpeg';
    const path = `${userId}/${id}-${paths.length}.${contentType.split('/')[1]}`;
    await uploadPhoto(supabase, path, await new File(photo.uri).arrayBuffer(), contentType);
    paths.push(path);
  }
  await insertReport({ id, kind: 'general', label, note: note.trim(), photo_paths: paths });
}
