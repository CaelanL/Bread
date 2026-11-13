import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real store against a stubbed HTTP boundary (Supabase REST and auth): deleting a verse or a
// collection is one server call that succeeds whole or changes nothing, and adding a verse is one
// call that keeps the one card a collection already holds.
test('deleting a verse or a collection and re-adding a held verse', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-collection-test-'));
  const platform = join(fixture, 'platform.cjs');
  const storage = join(fixture, 'storage.cjs');
  writeFileSync(platform, 'exports.Platform = { OS: "ios" }; exports.Alert = { alert() {} }; exports.TurboModuleRegistry = { get() { return null; } };');
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

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  const collections = [
    { id: 'c-psalms', client_id: 'psalms', name: 'Psalms', is_default: false, created_at: '2026-11-01T00:00:00Z',
      sort_preference: null, icon_key: null, shared_collection_id: null },
    { id: 'c-week', client_id: 'week', name: 'This Week', is_default: false, created_at: '2026-11-02T00:00:00Z',
      sort_preference: null, icon_key: null, shared_collection_id: null },
    { id: 'c-today', client_id: 'today', name: 'Today', is_default: false, created_at: '2026-11-03T00:00:00Z',
      sort_preference: null, icon_key: null, shared_collection_id: null },
  ];
  const verse = { id: 'v-1', client_id: 'verse-1', book: 'Psalms', chapter: 23, verse_start: 1, verse_end: 1, version: 'ESV',
    progress: { easy: { bestAccuracy: 100, completed: true }, medium: { bestAccuracy: null, completed: false },
      hard: { bestAccuracy: null, completed: false } },
    deleted_at: null, last_practiced_at: '2026-11-10T00:00:00Z', last_chunk_size: 3, last_difficulty: 'medium' };
  const failing = new Set();
  const writes = [];
  const json = (body, status = 200) => Response.json(body, { status });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const single = String(new Headers(init.headers).get('accept')).includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    }
    if (url.pathname === '/auth/v1/user') return json({ id: 'A' });
    if (url.pathname.startsWith('/rest/v1/rpc/get_')) return json([]);
    if (url.pathname === '/rest/v1/rpc/add_verse') {
      const body = JSON.parse(init.body);
      writes.push([`${method} ${url.pathname}`, body]);
      // The server holds the reference already, in every collection the stub knows.
      return collections.some((c) => c.client_id === body.p_collection_client_id)
        ? json(verse)
        : json({ code: '22023', message: 'Collection not found' }, 400);
    }
    if (method !== 'GET') {
      writes.push([`${method} ${url.pathname}`, init.body ? JSON.parse(init.body) : null]);
      if (failing.has(url.pathname)) {
        return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/profiles') return json({ translation: 'ESV', display_name: 'Avery' });
    if (url.pathname === '/rest/v1/user_collections') {
      const clientId = url.searchParams.get('client_id')?.replace(/^eq\./, '');
      const rows = clientId ? collections.filter((c) => c.client_id === clientId) : collections;
      return single ? (rows[0] ? json(rows[0]) : json({ code: 'PGRST116' }, 406)) : json(rows);
    }
    if (url.pathname === '/rest/v1/user_verses') return json([verse]);
    if (url.pathname === '/rest/v1/verse_collections' && url.searchParams.get('select')?.includes('user_collections')) {
      return json(collections.map((c) => ({ added_at: c.created_at, user_collections: { client_id: c.client_id }, user_verses: verse })));
    }
    return json([]);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const state = useAppStore.getState;
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).error);
  await state().refresh();
  const cards = (collectionId) => state().verses.filter((v) => v.id === 'verse-1' && v.collectionId === collectionId);
  assert.equal(cards('psalms').length, 1);
  assert.equal(cards('week').length, 1);

  await t.test('adding a verse the collection already holds is one server call and keeps one card with its study choices', async () => {
    writes.length = 0;
    const added = await state().addVerse({ book: 'Psalms', chapter: 23, verseStart: 1, verseEnd: 1 }, 'psalms');
    assert.deepEqual(writes, [['POST /rest/v1/rpc/add_verse', { p_book: 'Psalms', p_chapter: 23, p_verse_start: 1,
      p_verse_end: 1, p_version: 'ESV', p_collection_client_id: 'psalms', p_keep_restored_version: false }]]);
    assert.equal(cards('psalms').length, 1);
    assert.equal(added.lastChunkSize, 3);
    assert.equal(added.lastDifficulty, 'medium');
  });

  await t.test("adding to a collection the server doesn't have throws its reason and adds no card", async () => {
    const before = state().verses.length;
    await assert.rejects(state().addVerse({ book: 'Psalms', chapter: 23, verseStart: 1, verseEnd: 1 }, 'deleted-elsewhere'),
      { code: '22023', message: 'Collection not found' });
    assert.equal(state().verses.length, before);
  });

  await t.test('a failed verse delete throws and puts the card back', async () => {
    writes.length = 0;
    failing.add('/rest/v1/rpc/delete_verse');
    await assert.rejects(state().deleteVerse('verse-1', 'today'));
    failing.clear();
    assert.deepEqual(writes.map(([w]) => w), ['POST /rest/v1/rpc/delete_verse']);
    assert.equal(cards('today').length, 1);
  });

  await t.test('deleting a verse is one server call, and only that card leaves', async () => {
    writes.length = 0;
    await state().deleteVerse('verse-1', 'today');
    assert.deepEqual(writes, [['POST /rest/v1/rpc/delete_verse', { verse_client_id: 'verse-1', collection_client_id: 'today' }]]);
    assert.equal(cards('today').length, 0);
    assert.equal(cards('psalms').length, 1, 'the verse stays in its other collections');
    assert.equal(cards('week').length, 1);
  });

  await t.test('a failed delete throws and changes nothing locally', async () => {
    writes.length = 0;
    failing.add('/rest/v1/rpc/delete_collection');
    await assert.rejects(state().deleteCollection('week'));
    failing.clear();
    assert.deepEqual(writes.map(([w]) => w), ['POST /rest/v1/rpc/delete_collection']);
    assert.ok(state().collections.some((c) => c.id === 'week'));
    assert.equal(cards('week').length, 1);
  });

  await t.test('deleting a collection is one server call, then the collection and its cards leave', async () => {
    writes.length = 0;
    await state().deleteCollection('week');
    assert.deepEqual(writes, [['POST /rest/v1/rpc/delete_collection', { collection_client_id: 'week' }]]);
    assert.ok(!state().collections.some((c) => c.id === 'week'));
    assert.equal(cards('week').length, 0);
    assert.equal(cards('psalms').length, 1, 'the verse stays in its other collection');
  });
});
