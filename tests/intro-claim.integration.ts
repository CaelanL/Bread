import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.BREAD_LOCAL_TEST_PASSWORD;
assert.ok(url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Use a disposable local database.');
const cwdUrl = readFileSync('.env.local', 'utf8').match(/^EXPO_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/m)?.[1];
assert.equal(cwdUrl, url, 'Run from the same disposable worktree as the selected environment.');
assert.ok(key && password, 'Supply the local seed login.');
const client = (transport: typeof fetch = fetch) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});

test('two real devices race for one account claim and another account remains independent', async () => {
  const first = client(); const second = client(); const other = client();
  const [a, b, c] = await Promise.all([
    first.auth.signInWithPassword({ email: 'reader-a@example.test', password }),
    second.auth.signInWithPassword({ email: 'reader-a@example.test', password }),
    other.auth.signInWithPassword({ email: 'reader-b@example.test', password }),
  ]);
  assert.ok(a.data.session && b.data.session && c.data.session);
  const introId = 'concurrent-intro-' + Date.now();
  const results = await Promise.all([first, second].map((reader) => reader.rpc('claim_intro_presentation', { p_intro_id: introId })));
  results.forEach(({ error }) => assert.ifError(error));
  assert.deepEqual(results.map(({ data }) => data).sort(), [false, true]);
  const again = await client().auth.signInWithPassword({ email: 'reader-a@example.test', password });
  assert.ok(again.data.session);
  assert.equal((await first.rpc('claim_intro_presentation', { p_intro_id: introId })).data, false);
  assert.equal((await other.rpc('claim_intro_presentation', { p_intro_id: introId })).data, true);
});

test('dropping a successful claim acknowledgement cannot grant a second automatic attempt', async () => {
  const introId = 'lost-ack-intro-' + Date.now();
  let committed = false;
  const disconnected = client(async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok && String(input).endsWith('/rpc/claim_intro_presentation')) {
      committed = await response.json();
      throw new TypeError('Dropped acknowledgement after commit.');
    }
    return response;
  });
  assert.ok((await disconnected.auth.signInWithPassword({ email: 'reader-a@example.test', password })).data.session);
  assert.ok((await disconnected.rpc('claim_intro_presentation', { p_intro_id: introId })).error);
  assert.equal(committed, true);
  const nextDevice = client();
  assert.ok((await nextDevice.auth.signInWithPassword({ email: 'reader-a@example.test', password })).data.session);
  assert.equal((await nextDevice.rpc('claim_intro_presentation', { p_intro_id: introId })).data, false);
});
