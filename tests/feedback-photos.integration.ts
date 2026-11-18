import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { newReportId, saveReport, uploadPhoto } from '../lib/feedback/save';

// Real Storage API against the local stack: what a reader can do with feedback photos, and that
// deleting the account and running the sweep removes them. Run on a local stack, with the API
// port from `npm run db:status`:
//   set -a; . ./.env.local; set +a
//   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port> npx tsx --test tests/feedback-photos.integration.ts
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Use a disposable local database.');
assert.ok(key, 'Supply the local anon key.');
const cronSecret = readFileSync('supabase/config.toml', 'utf8').match(/^cron_secret = "([^"]+)"/m)?.[1];
assert.ok(cronSecret, 'The local cron secret is in supabase/config.toml.');

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

// Clients can't read reports, so count through the local database CLI.
function countRows(reportId: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'bread-feedback-'));
  try {
    const file = join(dir, 'count.sql');
    writeFileSync(file, `begin; create extension if not exists pgtap with schema extensions; select plan(1);
      select diag((select count(*) from public.feedback_reports where id = '${reportId}')::text);
      select pass('counted'); select * from finish(); rollback;`);
    const r = spawnSync('node_modules/.bin/supabase', ['test', 'db', '--local', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return Number(`${r.stdout}${r.stderr}`.match(/^# (\d+)$/m)?.[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function sweep() {
  const response = await fetch(`${url}/functions/v1/delete-feedback-photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()).removed as number;
}

test('a reader uploads only into their own folder, cannot read back, and the photos leave with the account', async () => {
  const client = createClient(url!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signUp, error: signUpError } = await client.auth.signUp({
    email: `feedback-${Date.now()}@example.test`,
    password: `local-${crypto.randomUUID()}`,
  });
  assert.ifError(signUpError);
  const userId = signUp.user!.id;
  const photos = client.storage.from('feedback-photos');

  const own = `${userId}/${crypto.randomUUID()}.png`;
  assert.ifError((await photos.upload(own, PNG, { contentType: 'image/png' })).error);
  assert.ok((await photos.upload(`${crypto.randomUUID()}/x.png`, PNG, { contentType: 'image/png' })).error, 'another folder is refused');
  assert.ok((await photos.upload(`${userId}/note.txt`, PNG, { contentType: 'text/plain' })).error, 'non-images are refused');
  const tooBig = new Uint8Array(50 * 1024 * 1024 + 1);
  assert.ok((await photos.upload(`${userId}/big.png`, tooBig, { contentType: 'image/png' })).error, 'photos over 50 MB are refused');

  const listed = await photos.list(userId);
  assert.deepEqual(listed.data ?? [], [], 'a reader cannot list photos');
  assert.ok((await photos.download(own)).error, 'a reader cannot read a photo back');

  // A send whose insert committed but whose answer was lost: the retry reuses the id and the path.
  const reportId = newReportId();
  const retried = `${userId}/${reportId}-0.png`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await uploadPhoto(client, retried, PNG.buffer, 'image/png');
    await saveReport(client, { id: reportId, kind: 'general', label: 'bug', note: 'Integration test', photo_paths: [own, retried] });
  }
  assert.equal(countRows(reportId), 1, 'a retried send saves one report');
  assert.ok((await client.from('feedback_reports').select('id')).error, 'a reader cannot read reports');

  assert.ifError((await client.rpc('delete_own_account')).error);
  assert.ok((await sweep()) >= 1, 'the sweep removes the deleted account\'s photo');
  assert.equal(await sweep(), 0, 'nothing orphaned is left after one sweep');
});
