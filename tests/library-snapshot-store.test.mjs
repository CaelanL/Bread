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
    const index = held.findIndex((entry) => entry.path === url.pathname && (method === 'GET' || url.pathname.startsWith('/rest/v1/rpc/')));
    if (index >= 0) {
      const [entry] = held.splice(index, 1);
      entry.request.resolve(account);
      return entry.response.promise;
    }
    if (offline) throw new TypeError('Network request failed');
    if (url.pathname === '/rest/v1/rpc/save_verse_progress') {
      const body = JSON.parse(init.body);
      return Response.json([{ applied: true, progress: body.p_progress, last_practiced_at: body.p_last_practiced_at, updated_at: '2026-11-14T00:00:00.000001+00:00' }]);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
    if (method !== 'GET') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      const row = { translation: 'ESV', display_name: account + ' L.', first_name: account, last_name: 'L', welcome_v2_seen_at: null };
      return Response.json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/user_collections') {
      return Response.json([{ client_id: 'my-verses', name: 'My Verses', is_default: true, created_at: '2026-11-01T00:00:00Z' },
        { client_id: 'psalms', name: 'Psalms', is_default: false, created_at: '2026-11-02T00:00:00Z' }]);
    }
    if (url.pathname === '/rest/v1/verse_collections') return Response.json(verseRows[account]);
    return Response.json([]);
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { setAccount } = await import('../lib/auth/account.ts');
  const { serializeSnapshot } = await import('../lib/store/snapshot.ts');
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

  await t.test('with no account started (signed out, or painted while the session restores), whenSynced answers false at once', async () => {
    store().clear();
    assert.equal(await store().whenSynced(), false);
  });

  await t.test('a failed wave leaves synced false, and whenSynced answers false after one more try', async () => {
    offline = true;
    await store().hydrate('A');
    assert.equal(store().synced, false);
    assert.equal(await store().whenSynced(), false);
    offline = false;
    assert.equal(await store().whenSynced(), true, 'once the network is back, the retry syncs');
  });

  const painted = (account, id, savedAt = Date.now()) => serializeSnapshot({
    collections: [{ id: 'my-verses', name: 'My Verses', isDefault: true, createdAt: 0 }],
    verses: [{ ...membershipVerse(id), text: 'never on disk' }],
    masteredVerses: [],
    sharedCollections: {},
    displayName: account + ' L.', firstName: account, lastName: 'L',
  }, savedAt);
  const membershipVerse = (id) => ({
    id, collectionId: 'my-verses', book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, version: 'ESV', createdAt: 0,
    progress: { easy: { bestAccuracy: null, completed: false }, medium: { bestAccuracy: null, completed: false }, hard: { bestAccuracy: null, completed: false } },
    updatedAt: '2026-11-01T00:00:00.000001+00:00',
  });
  const saved = (account) => JSON.parse(storage.get('library_snapshot:' + account) ?? 'null');

  await t.test('a launch paints the saved library at once, then the server\'s replaces it and is saved', async () => {
    store().clear();
    storage.set('library_snapshot:A', painted('A', 'A-snap'));
    const wave = hold('/rest/v1/verse_collections');
    setAccount('A');
    await wave.sent;
    await until(() => store().hydrated);
    assert.equal(store().hydratedFrom, 'snapshot');
    assert.deepEqual(store().verses.map((v) => v.id), ['A-snap']);
    assert.deepEqual(store().collections.map((c) => c.id), ['my-verses', 'mastered', 'in-progress']);
    assert.equal(store().displayName, 'A L.');
    assert.equal(store().synced, false);
    const before = storage.get('library_snapshot:A');
    wave.reply(Response.json(verseRows.A));
    await until(() => store().synced);
    assert.equal(store().hydratedFrom, 'server');
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse']);
    assert.notEqual(storage.get('library_snapshot:A'), before, 'nothing was written before synced, then the server\'s library was');
    assert.deepEqual(saved('A').verses.map((v) => v.id), ['A-verse']);
  });

  await t.test('a progress save is in the snapshot as soon as it returns', async () => {
    await store().updateVerseProgress('A-verse', 'easy', 70);
    assert.equal(saved('A').verses[0].progress.easy.bestAccuracy, 70);
    assert.equal(saved('A').verses[0].updatedAt, '2026-11-14T00:00:00.000001+00:00');
  });

  await t.test('another account never gets A\'s snapshot, even when A\'s read is still going', async () => {
    await signIn('B');
    storage.set('library_snapshot:B', painted('B', 'B-snap'));
    const seen = new Set();
    const unsubscribe = useAppStore.subscribe(({ verses }) => verses.forEach((v) => seen.add(v.id)));
    const wave = hold('/rest/v1/verse_collections');
    setAccount('B');
    await wave.sent;
    await until(() => store().hydrated);
    wave.reply(Response.json(verseRows.B));
    await until(() => store().synced);
    unsubscribe();
    assert.equal([...seen].some((id) => id.startsWith('A-')), false);
    assert.deepEqual([...seen].sort(), ['B-snap', 'B-verse']);
    assert.ok(storage.has('library_snapshot:A'), 'switching accounts keeps A\'s for A\'s next launch');
  });

  await t.test('a too-old snapshot is removed and not painted', async () => {
    store().clear();
    setAccount(null);
    await signIn('B');
    storage.set('library_snapshot:B', painted('B', 'B-snap', Date.now() - 8 * 24 * 60 * 60 * 1000));
    const wave = hold('/rest/v1/verse_collections');
    setAccount('B');
    await wave.sent;
    await until(() => !storage.has('library_snapshot:B'));
    assert.equal(store().hydrated, false);
    wave.reply(Response.json(verseRows.B));
    await until(() => store().synced);
    assert.equal(store().hydratedFrom, 'server');
  });

  await t.test('a late progress save after sign-out saves nothing, and sign-out removes the key', async () => {
    const save = hold('/rest/v1/rpc/save_verse_progress');
    const saving = store().updateVerseProgress('B-verse', 'easy', 80);
    await save.sent;
    setAccount(null);
    assert.equal(storage.has('library_snapshot:B'), false);
    save.reply(Response.json([{ applied: true, progress: {}, last_practiced_at: null, updated_at: '2026-11-14T00:00:01.000001+00:00' }]));
    await saving;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(storage.has('library_snapshot:B'), false);
  });

  await t.test('a failed launch keeps the old snapshot as it was', async () => {
    await signIn('A');
    const before = storage.get('library_snapshot:A');
    offline = true;
    setAccount('A');
    await until(() => store().hydratedFrom === 'server');
    offline = false;
    assert.equal(store().synced, false);
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse'], 'the saved library stays on screen');
    assert.equal(storage.get('library_snapshot:A'), before);
  });

  await t.test('a delete confirm waits for the server\'s library and counts from it', async () => {
    const { Alert } = await import('react-native');
    const { confirmRemoveCollection } = await import('../components/shared/member-actions.ts');
    const alerts = [];
    t.mock.method(Alert, 'alert', (...args) => alerts.push(args));
    // Saved: Psalms is empty. On the server, another device has since added a verse to it.
    verseRows.A = [membership('A'), { ...membership('A', 'A-psalm'), user_collections: { client_id: 'psalms' } }];
    setAccount(null);
    storage.set('library_snapshot:A', serializeSnapshot({
      collections: [{ id: 'my-verses', name: 'My Verses', isDefault: true, createdAt: 0 }, { id: 'psalms', name: 'Psalms', isDefault: false, createdAt: 1 }],
      verses: [membershipVerse('A-verse')], masteredVerses: [], sharedCollections: {},
      displayName: 'A L.', firstName: 'A', lastName: 'L',
    }, Date.now()));
    const wave = hold('/rest/v1/verse_collections');
    setAccount('A');
    await wave.sent;
    await until(() => store().hydratedFrom === 'snapshot');
    const confirming = confirmRemoveCollection('psalms');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(alerts, [], 'no dialog from the saved library');
    wave.reply(Response.json(verseRows.A));
    await confirming;
    assert.equal(alerts.length, 1);
    assert.match(alerts[0][1], /will be deleted and lose progress/);
    Alert.alert.mock.restore();
  });
});
