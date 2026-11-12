import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real store against a stubbed HTTP boundary (Supabase REST and auth): join, then leave.
test('joining and leaving a shared collection', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-shared-test-'));
  const platform = join(fixture, 'platform.cjs');
  const storage = join(fixture, 'storage.cjs');
  writeFileSync(platform, 'exports.Platform = { OS: "ios" }; exports.Alert = { alert() {} };');
  writeFileSync(storage, `const values = new Map(); module.exports = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); }
  };`);
  const native = { 'react-native': platform, '@react-native-async-storage/async-storage': storage };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return Object.hasOwn(native, specifier)
        ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'D' })).toString('base64url') + '.AA';
  const group = 'g-1';
  const copy = { client_id: `shared-${group}`, name: 'Romans 8', is_default: false, created_at: '2026-11-11T00:00:00Z',
    sort_preference: null, icon_key: null, shared_collection_id: group };
  const verse = { id: 'v-1', client_id: 'verse-1', book: 'Romans', chapter: 8, verse_start: 28, verse_end: 28, version: 'NIV',
    progress: { easy: { bestAccuracy: null, completed: false }, medium: { bestAccuracy: null, completed: false },
      hard: { bestAccuracy: null, completed: false } }, deleted_at: null };
  let joined = false;
  const rpcs = [];
  const reads = [];
  const json = (body, status = 200) => Response.json(body, { status });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'D' } });
    }
    if (url.pathname === '/auth/v1/user') return json({ id: 'D' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      rpcs.push([name, init.body ? JSON.parse(init.body) : null]);
      if (name === 'join_shared_collection') { joined = true; return json(copy.client_id); }
      if (name === 'leave_shared_collection') { joined = false; return new Response(null, { status: 204 }); }
      if (name === 'get_shared_status') {
        return json(joined ? [{ shared_id: group, member_count: 2, verse_count: 1, mastered_squares: 0, engraved_squares: 0 }] : []);
      }
      return json([]);
    }
    if (method !== 'GET') return new Response(null, { status: 204 });
    reads.push(url.pathname);
    if (url.pathname === '/rest/v1/profiles') return json({ translation: 'NIV', display_name: 'Dana' });
    if (url.pathname === '/rest/v1/user_collections') return json(joined ? [copy] : []);
    if (url.pathname === '/rest/v1/shared_collections') return json(joined ? [{ id: group, owner_id: 'C', name: 'Romans 8' }] : []);
    if (url.pathname === '/rest/v1/shared_collection_members') {
      return json(joined ? [{ shared_collection_id: group, role: 'member' }] : []);
    }
    if (url.pathname === '/rest/v1/verse_collections' && url.searchParams.get('select')?.includes('user_collections')) {
      return json(joined ? [{ added_at: '2026-11-11T00:00:00Z', user_collections: { client_id: copy.client_id }, user_verses: verse }] : []);
    }
    return json([]);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const state = useAppStore.getState;
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'D@example.test', password: 'test' })).error);
  await state().refresh();
  assert.equal(state().bibleVersion, 'NIV');

  await t.test('join sends the normalized code and the account translation, then refreshes', async () => {
    rpcs.length = 0;
    reads.length = 0;
    const id = await state().joinSharedCollection('bread-828');
    assert.equal(id, copy.client_id);
    assert.deepEqual(rpcs[0], ['join_shared_collection', { p_code: 'BREAD828', p_version: 'NIV' }]);
    for (const table of ['user_collections', 'verse_collections', 'shared_collections']) {
      assert.ok(reads.includes(`/rest/v1/${table}`), `refetched ${table}`);
    }
    const collection = state().collections.find((c) => c.id === copy.client_id);
    assert.equal(collection?.sharedId, group);
    assert.equal(state().sharedCollections[group]?.role, 'member');
    assert.equal(state().verses.filter((v) => v.collectionId === copy.client_id).length, 1);
  });

  await t.test("a member's delete is leave: the leave RPC, and the copy leaves the store", async () => {
    rpcs.length = 0;
    await state().deleteCollection(copy.client_id);
    assert.deepEqual(rpcs.map(([name]) => name), ['leave_shared_collection']);
    assert.deepEqual(rpcs[0][1], { p_shared: group });
    assert.equal(state().collections.some((c) => c.id === copy.client_id), false);
    assert.equal(state().verses.some((v) => v.collectionId === copy.client_id), false);
    assert.equal(state().sharedCollections[group], undefined);
  });
});
