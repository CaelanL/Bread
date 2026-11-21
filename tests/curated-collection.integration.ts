import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { importCollection } from '../lib/collections/import';
import type { Database } from '../supabase/database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.BREAD_LOCAL_TEST_EMAIL;
const password = process.env.BREAD_LOCAL_TEST_PASSWORD;

assert.ok(url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Use the local worktree database.');
assert.ok(key && email && email.endsWith('@example.test') && password, 'Supply a local seed login.');

const client = (transport: typeof fetch = fetch) => createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: transport },
});

async function saverCount(reader: ReturnType<typeof client>, catalogId: string) {
  const { data, error } = await reader.rpc('get_curated_collection_saver_counts', { p_catalog_ids: [catalogId] });
  assert.ifError(error);
  assert.equal(data?.length, 1);
  return data![0].saver_count;
}

test('concurrent authenticated imports share one collection and retain an existing verse', async () => {
  const first = client();
  const second = client();
  const [a, b] = await Promise.all([
    first.auth.signInWithPassword({ email, password }),
    second.auth.signInWithPassword({ email, password }),
  ]);
  assert.ok(a.data.session && b.data.session, 'Local sign-ins failed.');
  const saversBefore = await saverCount(first, 'salvation');

  const { data: before } = await first
    .from('user_verses').select('*').eq('client_id', 'seed-john-3-16').single();
  assert.ok(before, 'Use the local seed reader with John 3:16 already saved.');

  const [one, two] = await Promise.all([
    importCollection(first, a.data.session, 'salvation', 'ESV'),
    importCollection(second, b.data.session, 'salvation', 'ESV'),
  ]);
  assert.ok(one.row && two.row);
  assert.equal(one.row.id, two.row.id);
  assert.equal(one.row.verse_collections.length, 12);
  assert.equal(two.row.verse_collections.length, 12);
  assert.deepEqual(one.row.verse_collections.find((link) => link.user_verses.id === before.id)?.user_verses, before);

  const { count, error } = await first.from('verse_collections')
    .select('id', { count: 'exact', head: true }).eq('verse_id', before.id);
  assert.ifError(error);
  assert.equal(count, 2);
  assert.equal(await saverCount(first, 'salvation'), saversBefore + 1);
});

test('a lost response safely retries through the same import path', async () => {
  const reader = client();
  const { data: { session } } = await reader.auth.signInWithPassword({ email, password });
  assert.ok(session, 'Local sign-in failed.');
  const saversBefore = await saverCount(reader, 'salvation');

  let committedId: string | undefined;
  const disconnected = client(async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok && String(input).endsWith('/rpc/import_curated_collection')) {
      committedId = await response.json();
      throw new Error('Simulated disconnect after the database committed the import.');
    }
    return response;
  });

  await assert.rejects(importCollection(disconnected, session, 'salvation', 'KJV'), /Try again/);
  assert.ok(committedId, 'The first call committed before the response was dropped.');

  const result = await importCollection(reader, session, 'salvation', 'KJV');
  assert.ok(result.row);
  assert.equal(result.row.id, committedId);
  assert.equal(result.row.verse_collections.length, 12);
  assert.ok(result.row.verse_collections.every((link) => link.user_verses.version === 'KJV'));
  assert.equal(await saverCount(reader, 'salvation'), saversBefore);
});

test('a failed readback reports the saved collection without another write', async () => {
  const reader = client();
  const { data: { session } } = await reader.auth.signInWithPassword({ email, password });
  assert.ok(session, 'Local sign-in failed.');
  const saversBefore = await saverCount(reader, 'hope');

  const unreadable = client((input, init) => {
    if (String(input).includes('/rest/v1/user_collections?')) {
      return Promise.resolve(new Response('Unavailable', { status: 403 }));
    }
    return fetch(input, init);
  });

  const result = await importCollection(unreadable, session, 'hope', 'KJV');
  assert.equal(result.row, null);
  const { data, error } = await reader.from('user_collections')
    .select('name').eq('client_id', result.collectionId).single();
  assert.ifError(error);
  assert.equal(data?.name, 'Hope');
  assert.equal(await saverCount(reader, 'hope'), saversBefore + 1);
});

test('concurrent different-version imports count one account, then a second account counts separately', async () => {
  const first = client();
  const second = client();
  const [a, b] = await Promise.all([
    first.auth.signInWithPassword({ email, password }),
    second.auth.signInWithPassword({ email, password }),
  ]);
  assert.ok(a.data.session && b.data.session);
  const before = await saverCount(first, 'prayer');
  const [one, two] = await Promise.all([
    importCollection(first, a.data.session, 'prayer', 'KJV'),
    importCollection(second, b.data.session, 'prayer', 'ESV'),
  ]);
  assert.ok(one.row && two.row);
  assert.notEqual(one.row.id, two.row.id);
  assert.equal(await saverCount(first, 'prayer'), before + 1);

  const other = client();
  const { data: { session } } = await other.auth.signInWithPassword({ email: 'reader-b@example.test', password });
  assert.ok(session);
  await importCollection(other, session, 'prayer', 'KJV');
  assert.equal(await saverCount(first, 'prayer'), before + 2);
});
