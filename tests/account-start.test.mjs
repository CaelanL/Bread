import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const createdAt = '2026-11-10T00:00:00Z';
const membership = (account) => ({
  added_at: createdAt,
  user_collections: { client_id: 'my-verses' },
  user_verses: {
    client_id: account + '-verse', book: 'John', chapter: 3, verse_start: 16, verse_end: 16,
    version: 'ESV', progress: {},
  },
});
const prefsRow = (account) => ({
  user_id: account, master_enabled: account === 'A', reviews_enabled: true, reviews_cadence: 'daily',
  reviews_weekday: null, reviews_hour: 9, reviews_minute: 0, in_progress_enabled: true,
  in_progress_cadence: 'weekly', in_progress_weekday: 1, in_progress_hour: 18, in_progress_minute: 0,
  timezone: 'UTC',
});

// The real account start, store and prefs store against a stubbed HTTP boundary.
test('accounts start from the auth session, keyed by user id', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-account-start-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const native = {
    // Not iOS, so the foreground sync reads no notification permission.
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
  const hold = (path, method = 'GET') => {
    const request = Promise.withResolvers();
    const response = Promise.withResolvers();
    held.push({ path, method, request, response });
    return { sent: request.promise, reply: response.resolve };
  };
  const profileReads = [];
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
    const index = held.findIndex((entry) => entry.path === url.pathname && entry.method === method);
    if (index >= 0) {
      const [entry] = held.splice(index, 1);
      entry.request.resolve(account);
      return entry.response.promise;
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
    if (method !== 'GET') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      profileReads.push(account);
      const row = { translation: 'ESV', display_name: account };
      return Response.json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/verse_collections') return Response.json([membership(account)]);
    if (url.pathname === '/rest/v1/notification_preferences') return Response.json(object ? prefsRow(account) : [prefsRow(account)]);
    return Response.json([]);
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { setAccount } = await import('../lib/auth/account.ts');
  const { useAppStore } = await import('../lib/store/index.ts');
  const { usePrefsStore } = await import('../lib/notifications/preferences.ts');
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

  await t.test('a launch signed out clears no prefs cache', () => {
    storage.set('notifications_prefs_cache:A', JSON.stringify({ masterEnabled: true }));
    setAccount(null);
    assert.ok(storage.has('notifications_prefs_cache:A'));
  });

  await t.test('B after A with no sign-out: A is cleared, B is loaded, and A\'s late reply is dropped', async () => {
    await signIn('A');
    const aVerses = hold('/rest/v1/verse_collections');
    setAccount('A');
    assert.equal(await aVerses.sent, 'A');

    await signIn('B');
    const bPrefs = hold('/rest/v1/notification_preferences');
    const seenPrefs = [];
    const unsubscribe = usePrefsStore.subscribe(({ prefs }) => seenPrefs.push(prefs));
    setAccount('B');
    assert.deepEqual(store().verses, []);
    assert.equal(store().hydrated, false);

    aVerses.reply(Response.json([membership('A')]));
    await until(() => store().hydrated);
    assert.deepEqual(store().verses.map((v) => v.id), ['B-verse']);
    assert.equal(store().displayName, 'B');

    // A's cached prefs (master on) never reach B, before or after B's own read.
    assert.equal(await bPrefs.sent, 'B');
    bPrefs.reply(Response.json(prefsRow('B')));
    await until(() => usePrefsStore.getState().prefs !== null);
    unsubscribe();
    assert.equal(seenPrefs.some((prefs) => prefs?.masterEnabled === true), false);
    assert.equal(usePrefsStore.getState().prefs.masterEnabled, false);
    assert.equal(JSON.parse(storage.get('notifications_prefs_cache:B')).masterEnabled, false);
  });

  await t.test('the same account twice starts once', async () => {
    const reads = profileReads.length;
    setAccount('B');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(profileReads.length, reads);
    assert.deepEqual(store().verses.map((v) => v.id), ['B-verse']);
  });

  await t.test('signing out clears the stores and removes only that account\'s prefs cache', async () => {
    setAccount(null);
    assert.deepEqual(store().verses, []);
    assert.equal(usePrefsStore.getState().prefs, null);
    await until(() => !storage.has('notifications_prefs_cache:B'));
    assert.ok(storage.has('notifications_prefs_cache:A'));
  });
  await t.test("A's late default prefs land after a switch to B: dropped, never in B's store or cache", async () => {
    await signIn('A');
    setAccount('A');
    await until(() => usePrefsStore.getState().prefs !== null);
    const insert = hold('/rest/v1/notification_preferences', 'POST');
    const initializing = usePrefsStore.getState().initializeDefaults('UTC');
    assert.equal(await insert.sent, 'A');
    await signIn('B');
    setAccount('B');
    await until(() => storage.has('notifications_prefs_cache:B'));
    const bCache = storage.get('notifications_prefs_cache:B');
    insert.reply(Response.json({ ...prefsRow('A'), master_enabled: true, reviews_hour: 6 }));
    assert.equal(await initializing, null);
    assert.equal(usePrefsStore.getState().prefs.masterEnabled, false, "B's own prefs stay");
    assert.equal(storage.get('notifications_prefs_cache:B'), bCache);
  });

  await t.test("B's failed patch rolls back B's cache only, once A is the account", async () => {
    const update = hold('/rest/v1/notification_preferences', 'PATCH');
    const patching = usePrefsStore.getState().patch({ reviewsHour: 7 });
    assert.equal(await update.sent, 'B');
    await signIn('A');
    setAccount('A');
    await until(() => usePrefsStore.getState().prefs?.masterEnabled === true);
    const aCache = storage.get('notifications_prefs_cache:A');
    update.reply(Response.json({ message: 'nope' }, { status: 400 }));
    assert.equal(await patching, false);
    assert.equal(usePrefsStore.getState().prefs.masterEnabled, true, "A's prefs stay");
    assert.equal(storage.get('notifications_prefs_cache:A'), aCache);
    assert.equal(JSON.parse(storage.get('notifications_prefs_cache:B')).reviewsHour, 9, "B's cache is rolled back to B's own prefs");
  });
});
