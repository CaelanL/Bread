// lib-ok: Feedback's retry-safe writes, with no native imports so the retry test runs against a local stack.
import type { SupabaseClient } from '@supabase/supabase-js';

const PHOTO_BUCKET = 'feedback-photos';

function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** A report's id, made once per result or per Settings send, so a retry can't save it twice. */
export const newReportId = randomId;

/** A photo's id, made when it's picked. Its path comes from it, so a retry reuses what landed and a replaced photo never takes the old one's path. */
export const newPhotoId = randomId;

export interface PhotoUpload {
  id: string;
  contentType: string;
  read: () => Promise<ArrayBuffer>;
}

// An id or path that already exists means an earlier try saved it and only its answer was lost.
export async function saveReport(client: SupabaseClient, row: { id: string } & Record<string, unknown>): Promise<void> {
  const { error } = await client.from('feedback_reports').insert(row);
  if (error && error.code !== '23505') throw new Error(error.message);
}

/** Uploads each photo to its own path in the reader's folder, then saves the row with those paths. */
export async function saveReportWithPhotos(
  client: SupabaseClient,
  userId: string,
  row: { id: string } & Record<string, unknown>,
  photos: PhotoUpload[],
): Promise<void> {
  const paths: string[] = [];
  for (const photo of photos) {
    const path = `${userId}/${photo.id}.${photo.contentType.split('/')[1]}`;
    await uploadPhoto(client, path, await photo.read(), photo.contentType);
    paths.push(path);
  }
  await saveReport(client, { ...row, photo_paths: paths });
}

export async function uploadPhoto(client: SupabaseClient, path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, body, { contentType });
  if (error && !('statusCode' in error && error.statusCode === '409')) throw new Error(error.message);
}
