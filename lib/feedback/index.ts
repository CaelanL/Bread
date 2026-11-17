// lib-ok: Feedback writes (grading reports, Settings feedback and its photos) and their limits.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { sessionUserId, supabase } from '@/lib/api/client';
import type { GradingReport } from './grading-report';

/** The migration enforces the same numbers (table checks and the bucket). */
export const FEEDBACK_LIMITS = { noteLength: 4000, photos: 3, photoBytes: 5 * 1024 * 1024 } as const;

export type FeedbackLabel = 'idea' | 'bug' | 'other';

export interface FeedbackPhoto {
  uri: string;
  mimeType?: string;
}

const PHOTO_BUCKET = 'feedback-photos';

async function insertReport(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('feedback_reports').insert({
    ...row,
    app_version: Constants.expoConfig?.version ?? null,
    update_id: Updates.updateId ?? null,
    os: Platform.OS,
    os_version: String(Platform.Version),
    device_model: Device.modelName ?? null,
  });
  if (error) throw new Error(error.message);
}

export function sendGradingReport(details: GradingReport, note: string): Promise<void> {
  return insertReport({ kind: 'grading', note: note.trim(), details });
}

/** Uploads the photos into the reader's folder, then saves the report. A retry uploads fresh copies. */
export async function sendFeedback({ note, label, photos }: {
  note: string;
  label: FeedbackLabel | null;
  photos: FeedbackPhoto[];
}): Promise<void> {
  const userId = await sessionUserId();
  if (!userId) throw new Error('Not signed in');
  const paths: string[] = [];
  for (const photo of photos) {
    const contentType = photo.mimeType ?? 'image/jpeg';
    const path = `${userId}/${Date.now()}-${paths.length}.${contentType.split('/')[1]}`;
    const body = await new File(photo.uri).arrayBuffer();
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType });
    if (error) throw new Error(error.message);
    paths.push(path);
  }
  await insertReport({ kind: 'general', label, note: note.trim(), photo_paths: paths });
}
