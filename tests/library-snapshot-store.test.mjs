import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const membership = (account, id = account + '-verse') => ({
  added_at: '2026-11-10T00:00:00Z',
  user_collections: { client_id: 'my-verses' },
  user_verses: {
    client_id: id, book: 'John', chapter: 3, verse_start: 16, verse_end: 16, version: 'ESV',
    progress: {}, updated_at: '2026-11-10T00:00:00.123456+00:00',
  },
});

// The real store and account start against a stubbed HTTP boundary and an in-memory AsyncStorage.
test('the saved library: synced, snapshot read and write', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-snapshot-store-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const native = {
    'react-native': file('platform.cjs', 'exports.Platform = { OS: "android" }; exports.Alert = { alert() {} }; exports.Linking = {}; exports.InteractionManager = { runAfterInteractions() {} };'),
    '@react-native-async-storage/async-storage': file('storage.cjs', `
      const values = new Map(); globalThis.storedValues = values;
      module.exports = {
        async getItem(key) { return values.get(key) ?? null; },
        async setItem(key, value) { values.set(key, value); },
        async removeItem(key) { values.delete(key); },
      };`),
    'expo-notifications': file('notifications.cjs', 'module.exports = {};'),
    'expo-constants': file('constants.cjs', 'module.exports = { default: {} };'),
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return Object.hasOwn(native, specifier)
        ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });

  const tokens = Object.fromEntries(['A', 'B'].map((account) => [
    account, 'e30.' + Buffer.from(JSON.stringify({ sub: account })).toString('base64url') + '.AA',
  ]));
  const held = [];
  const hold = (path) => {
    const request = Promise.withResolvers();
    const response = Promise.withResolvers();
    held.push({ path, request, response });
    return { sent: request.promise, reply: response.resolve };
  };
  let offline = false;
  const verseRows = { A: [membership('A')], B: [membership('B')] };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const bearer = new Headers(init.headers).get('Authorization');
    const account = Object.keys(tokens).find((key) => bearer === 'Bearer ' + tokens[key]);
    const object = new Headers(init.headers).get('Accept')?.includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({ access_token: tokens[id], refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 3600, user: { id } });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    const index = held.findIndex((entry) => entry.path === url.pathname && method === 'GET');
    if (index >= 0) {
      const [entry] = held.splice(index, 1);
      entry.request.resolve(account);
      return entry.response.promise;
    }
    if (offline) throw new TypeError('Network request failed');
    if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
    if (method !== 'GET') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      const row = { translation: 'ESV', display_name: account + ' L.', first_name: account, last_name: 'L', welcome_v2_seen_at: null };
      return Response.json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/user_collections') {
      return Response.json([{ client_id: 'my-verses', name: 'My Verses', is_default: true, created_at: '2026-11-01T00:00:00Z' }]);
    }
    if (url.pathname === '/rest/v1/verse_collections') return Response.json(verseRows[account]);
    return Response.json([]);
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  const store = useAppStore.getState;
  const storage = globalThis.storedValues;
  const until = async (done) => {
    for (let i = 0; i < 1000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.ok(done(), 'timed out');
  };
  const signIn = async (account) => {
    assert.ifError((await supabase.auth.signInWithPassword({ email: account + '@example.test', password: 'test' })).error);
  };
  await signIn('A');

  await t.test('a read dropped for study prefs set during it leaves synced false, and its reread sets it', async () => {
    store().clear();
    // What a snapshot paint leaves: the library on screen, not yet synced.
    useAppStore.setState({ hydrated: true, verses: [{
      id: 'A-verse', collectionId: 'my-verses', book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, version: 'ESV',
      createdAt: 0, progress: { easy: { bestAccuracy: null, completed: false }, medium: { bestAccuracy: null, completed: false }, hard: { bestAccuracy: null, completed: false } },
    }] });
    const first = hold('/rest/v1/verse_collections');
    const refreshing = store().refresh();
    await first.sent;
    store().setVerseStudyPrefs('A-verse', 2, 'hard');
    const second = hold('/rest/v1/verse_collections');
    first.reply(Response.json(verseRows.A));
    await second.sent;
    assert.equal(store().synced, false, 'the first read was dropped');
    second.reply(Response.json(verseRows.A));
    await refreshing;
    assert.equal(store().synced, true);
    assert.equal(store().verses[0].updatedAt, '2026-11-10T00:00:00.123456+00:00', 'the server row replaced the painted one');
  });

  await t.test('clear() resets synced', () => {
    assert.equal(store().synced, true);
    store().clear();
    assert.equal(store().synced, false);
    assert.equal(store().hydratedFrom, null);
  });

  await t.test('a failed wave leaves synced false, and whenSynced answers false after one more try', async () => {
    offline = true;
    await store().refresh();
    assert.equal(store().synced, false);
    assert.equal(await store().whenSynced(), false);
    offline = false;
    assert.equal(await store().whenSynced(), true, 'once the network is back, the retry syncs');
  });
});
