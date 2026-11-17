// lib-ok: Feedback's retry-safe writes, with no native imports so the retry test runs against a local stack.
import type { SupabaseClient } from '@supabase/supabase-js';

const PHOTO_BUCKET = 'feedback-photos';

/** A report's id, made once per result or per Settings send, so a retry can't save it twice. */
export function newReportId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// An id or path that already exists means an earlier try saved it and only its answer was lost.
export async function saveReport(client: SupabaseClient, row: { id: string } & Record<string, unknown>): Promise<void> {
  const { error } = await client.from('feedback_reports').insert(row);
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function uploadPhoto(client: SupabaseClient, path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, body, { contentType });
  if (error && !('statusCode' in error && error.statusCode === '409')) throw new Error(error.message);
}
