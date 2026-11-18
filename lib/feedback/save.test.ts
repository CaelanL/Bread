// lib-ok: Regression test for feedback retries: a photo replaced after a partial upload is the one sent.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { newPhotoId, newReportId, saveReportWithPhotos } from './save';

// Supabase stand-in: Storage refuses an existing path with 409, like the real bucket without upsert,
// and the first insert fails the way a dropped connection would.
function fakeSupabase() {
  const files = new Map<string, string>();
  const rows: Record<string, unknown>[] = [];
  let insertsToFail = 1;
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, body: ArrayBuffer) => {
          if (files.has(path)) return { error: { statusCode: '409', message: 'The resource already exists' } };
          files.set(path, new TextDecoder().decode(body));
          return { error: null };
        },
      }),
    },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (insertsToFail-- > 0) return { error: { code: '', message: 'Network request failed' } };
        rows.push(row);
        return { error: null };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, files, rows };
}

const photo = (content: string) => ({
  id: newPhotoId(),
  contentType: 'image/jpeg',
  read: async () => new TextEncoder().encode(content).buffer as ArrayBuffer,
});

test('a photo replaced after a partial upload is the one the retried report points at', async () => {
  const { client, files, rows } = fakeSupabase();
  const row = { id: newReportId(), kind: 'general', note: 'The streak reset after midnight' };
  const a = photo('photo A');
  const b = photo('photo B');

  await assert.rejects(saveReportWithPhotos(client, 'reader', row, [a]), /Network request failed/);
  await saveReportWithPhotos(client, 'reader', row, [b]);

  assert.equal(rows.length, 1);
  const paths = rows[0].photo_paths as string[];
  assert.equal(paths.length, 1);
  assert.equal(files.get(paths[0]), 'photo B');
});

test('a retry with the same photo reuses its path', async () => {
  const { client, files, rows } = fakeSupabase();
  const row = { id: newReportId(), kind: 'general', note: 'Retry' };
  const a = photo('photo A');

  await assert.rejects(saveReportWithPhotos(client, 'reader', row, [a]));
  await saveReportWithPhotos(client, 'reader', row, [a]);

  assert.equal(files.size, 1);
  assert.deepEqual(rows[0].photo_paths, [...files.keys()]);
});
