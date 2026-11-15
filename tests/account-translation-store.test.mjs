import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real store against a stubbed HTTP boundary (Supabase REST and auth).
test('account translation sync and switch', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-translation-test-'));
  const platform = join(fixture, 'platform.cjs');
  const storage = join(fixture, 'storage.cjs');
  writeFileSync(platform, 'exports.Platform = { OS: "ios" }; exports.Alert = { alert() {} }; exports.InteractionManager = { runAfterInteractions() {} };');
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
  const progress = (mastered) => ({
    easy: { bestAccuracy: 95, completed: true },
    medium: { bestAccuracy: mastered ? 95 : null, completed: mastered },
    hard: { bestAccuracy: mastered ? 95 : null, completed: mastered },
  });
  const verse = (id, version, mastered, updatedAt = '2026-11-10T00:00:00.000001+00:00') => ({ id, client_id: id, book: 'John',
    chapter: 3, verse_start: 16, verse_end: 16, version, progress: progress(mastered), deleted_at: null, updated_at: updatedAt });
  let profile = 'NIV';
  let profileName = null;
  let noProfile = false;
  let identityRows = null;
  const requests = [];
  let heldProfile;
  let heldLinks;
  let failLinks = false;
  let deleteBlocked = false;
  let failUser = false;
  let failProfile = false;
  const writes = [];
  const json = (body, status = 200) => Response.json(body, { status });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const object = new Headers(init.headers).get('Accept')?.includes('vnd.pgrst.object');
    const select = url.searchParams.get('select') ?? '';
    requests.push(method + ' ' + url.pathname + (url.pathname === '/rest/v1/user_verses' && method === 'GET'
      ? (select.startsWith('id,client_id') ? ' identity' : ' mastered') : ''));
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    }
    if (url.pathname === '/auth/v1/user') return failUser ? json({ message: 'unavailable' }, 503) : json({ id: 'A' });
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      if (method !== 'GET') {
        writes.push(['profile', JSON.parse(init.body).translation]);
        profile = JSON.parse(init.body).translation;
        noProfile = false;
        return new Response(null, { status: 201 });
      }
      if (heldProfile) await heldProfile.promise;
      if (failProfile) return json({ message: 'unavailable' }, 503);
      if (noProfile) return json([]);
      const row = { translation: profile, display_name: profileName, first_name: profileName, last_name: null };
      return json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/user_verses' && method === 'GET' && select.startsWith('id,client_id')) {
      return json(identityRows ?? [verse('esv-row', 'ESV', true), verse('niv-row', 'NIV', false)]);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json([]);
    if (url.pathname === '/rest/v1/verse_collections' && method === 'GET' && heldLinks) await heldLinks.promise;
    if (url.pathname === '/rest/v1/verse_collections' && url.searchParams.get('select') === 'collection_id,added_at') {
      return failLinks ? json({ message: 'unavailable' }, 503) : json([]);
    }
    if (method === 'DELETE' && url.pathname === '/rest/v1/user_verses') {
      writes.push([method, url.pathname, url.searchParams.get('id')]);
      // Deletes only the row as it was read: one saved since has a newer updated_at.
      const id = url.searchParams.get('id').replace(/^eq\./, '');
      const current = (identityRows ?? []).find((row) => row.id === id);
      const changed = current && url.searchParams.has('updated_at') && 'eq.' + current.updated_at !== url.searchParams.get('updated_at');
      return json(deleteBlocked || changed ? [] : [{ id }]);
    }
    if (method !== 'GET') {
      writes.push([method, url.pathname, url.searchParams.get('id')]);
      return new Response(null, { status: 204 });
    }
    return json([]);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const { subscribeToToast } = await import('../lib/toast.ts');
  const state = useAppStore.getState;
  const toasts = [];
  subscribeToToast((message) => toasts.push(message));
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).error);

  await t.test('a failed collapse is shown, and pull to refresh retries it', async () => {
    failLinks = true;
    await state().refresh();
    assert.equal(state().bibleVersion, 'NIV');
    assert.match(toasts.at(-1), /Pull to refresh/);
    assert.equal(writes.some(([method]) => method === 'DELETE'), false);

    failLinks = false;
    deleteBlocked = true;
    await state().refresh();
    assert.match(toasts.at(-1), /Pull to refresh/, 'a delete that removes no row is an error');

    deleteBlocked = false;
    writes.length = 0;
    toasts.length = 0;
    await state().refresh();
    assert.deepEqual(toasts, []);
    assert.deepEqual(writes.filter(([method]) => method === 'DELETE'), [['DELETE', '/rest/v1/user_verses', 'eq.niv-row']]);
  });

  await t.test('a twin saved after the sync read it is never deleted as the loser: the collapse is picked again from fresh rows', async () => {
    profile = 'ESV';
    const behind = { easy: { bestAccuracy: 50, completed: false }, medium: { bestAccuracy: null, completed: false }, hard: { bestAccuracy: null, completed: false } };
    // When the sync reads them, the ESV twin is ahead.
    identityRows = [verse('esv-twin', 'ESV', false), { ...verse('kjv-twin', 'KJV', false), progress: behind }];
    heldProfile = Promise.withResolvers();
    writes.length = 0;
    const syncing = state().refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Then the KJV twin is mastered (its row is newer) before the profile answers.
    identityRows = [verse('esv-twin', 'ESV', false), verse('kjv-twin', 'KJV', true, '2026-11-14T00:00:00.000001+00:00')];
    heldProfile.resolve();
    heldProfile = undefined;
    await syncing;
    const deletes = writes.filter(([method]) => method === 'DELETE').map(([, , id]) => id);
    assert.deepEqual(deletes, ['eq.kjv-twin', 'eq.esv-twin'], 'the stale delete removed nothing; the mastered twin won the second pick');
    assert.ok(writes.some(([method, , id]) => method === 'PATCH' && id === 'in.(kjv-twin)'), 'the winner moves to ESV');
    identityRows = null;
    profile = 'NIV';
    await state().refresh();
  });

  await t.test('a pick made while the sync is still reading the profile is saved, not dropped', async () => {
    writes.length = 0;
    profile = 'ESV';
    heldProfile = Promise.withResolvers();
    const shown = [];
    const unsubscribe = useAppStore.subscribe(({ bibleVersion }) => shown.push(bibleVersion));
    const syncing = state().refresh();
    await new Promise((resolve) => setImmediate(resolve));
    const picking = state().setBibleVersion('KJV');
    heldProfile.resolve();
    heldProfile = undefined;
    await Promise.all([syncing, picking]);
    unsubscribe();
    assert.equal(shown.includes('ESV'), false);
    assert.equal(state().bibleVersion, 'KJV');
    assert.deepEqual(writes.filter(([kind]) => kind === 'profile'), [['profile', 'KJV']]);
    assert.equal(profile, 'KJV');
  });

  await t.test('the sync reads the signed-in id from the session, so a failed user request changes nothing', async () => {
    failUser = true;
    toasts.length = 0;
    profile = 'ESV';
    await state().refresh();
    failUser = false;
    assert.deepEqual(toasts, []);
    assert.equal(state().bibleVersion, 'ESV');
  });

  await t.test('a sync that fails after its account signed out shows nothing', async () => {
    toasts.length = 0;
    failProfile = true;
    heldProfile = Promise.withResolvers();
    const syncing = state().refresh();
    await new Promise((resolve) => setImmediate(resolve));
    state().clear();
    heldProfile.resolve();
    heldProfile = undefined;
    await syncing;
    failProfile = false;
    assert.deepEqual(toasts, []);
  });

  const count = (request) => requests.filter((r) => r === request).length;

  await t.test('one wave: the profile, identity and every library read start before any answers', async () => {
    state().clear();
    identityRows = [];
    profile = 'ESV';
    requests.length = 0;
    heldProfile = Promise.withResolvers();
    const loading = state().hydrate('A');
    for (let i = 0; i < 200 && !requests.includes('GET /rest/v1/profiles'); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sent = [...requests];
    heldProfile.resolve();
    heldProfile = undefined;
    await loading;
    for (const read of ['GET /rest/v1/profiles', 'GET /rest/v1/user_verses identity', 'GET /rest/v1/verse_collections',
      'GET /rest/v1/user_collections', 'GET /rest/v1/user_verses mastered', 'GET /rest/v1/shared_collections',
      'GET /rest/v1/shared_collection_members', 'POST /rest/v1/rpc/get_shared_status']) {
      assert.ok(sent.includes(read), read + ' waited for the profile');
    }
  });

  await t.test('the translation and name land in the same update as hydrated', async () => {
    state().clear();
    useAppStore.setState({ bibleVersion: 'ESV' });
    profile = 'NLT';
    profileName = 'Al';
    identityRows = [];
    requests.length = 0;
    let first = null;
    // The server's update, not the saved library's paint from the hydrate before.
    const unsubscribe = useAppStore.subscribe((s) => {
      if (s.hydratedFrom === 'server' && !first) first = { bibleVersion: s.bibleVersion, displayName: s.displayName, profileLoaded: s.profileLoaded };
    });
    await state().hydrate('A');
    unsubscribe();
    profileName = null;
    assert.deepEqual(first, { bibleVersion: 'NLT', displayName: 'Al', profileLoaded: true });
    // The translation changed, so verses and mastered are read again in it.
    assert.equal(count('GET /rest/v1/verse_collections'), 2);
    assert.equal(count('GET /rest/v1/user_verses mastered'), 2);
  });

  await t.test('nothing moved and the same translation: each library read once', async () => {
    useAppStore.setState({ bibleVersion: 'NLT' });
    profile = 'NLT';
    identityRows = [verse('nlt-row', 'NLT', false)];
    requests.length = 0;
    writes.length = 0;
    await state().refresh();
    assert.equal(count('GET /rest/v1/verse_collections'), 1);
    assert.equal(count('GET /rest/v1/user_verses mastered'), 1);
    assert.deepEqual(writes, []);
  });

  await t.test('rows behind the profile translation are moved, then verses and mastered read again', async () => {
    useAppStore.setState({ bibleVersion: 'NIV' });
    profile = 'NIV';
    identityRows = [verse('esv-only', 'ESV', false)];
    requests.length = 0;
    writes.length = 0;
    await state().refresh();
    assert.deepEqual(writes, [['PATCH', '/rest/v1/user_verses', 'in.(esv-only)']]);
    assert.equal(count('GET /rest/v1/verse_collections'), 2);
    assert.equal(count('GET /rest/v1/user_verses mastered'), 2);
    assert.equal(count('GET /rest/v1/user_verses identity'), 1);
  });

  await t.test('no profile: the translation is seeded from the rows and saved', async () => {
    state().clear();
    useAppStore.setState({ bibleVersion: 'ESV' });
    noProfile = true;
    identityRows = [verse('nkjv-1', 'NKJV', false), { ...verse('nkjv-2', 'NKJV', false), verse_start: 17, verse_end: 17 }];
    writes.length = 0;
    await state().hydrate('A');
    assert.deepEqual(writes, [['profile', 'NKJV']]);
    assert.equal(state().bibleVersion, 'NKJV');
    assert.equal(state().hydrated, true);
  });

  await t.test('a pick made while the launch wave is reading the profile is kept', async () => {
    state().clear();
    profile = 'ESV';
    identityRows = [];
    writes.length = 0;
    heldProfile = Promise.withResolvers();
    const loading = state().hydrate('A');
    for (let i = 0; i < 200 && !requests.includes('GET /rest/v1/profiles'); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    const picking = state().setBibleVersion('KJV');
    heldProfile.resolve();
    heldProfile = undefined;
    await Promise.all([loading, picking]);
    assert.equal(state().bibleVersion, 'KJV');
    assert.deepEqual(writes.filter(([kind]) => kind === 'profile'), [['profile', 'KJV']]);
  });
  await t.test('F29: a collapse that fails still rereads the verse lists, so a row it deleted leaves the screen', async () => {
    profile = 'NIV';
    identityRows = null;
    deleteBlocked = true;
    requests.length = 0;
    toasts.length = 0;
    await state().refresh();
    deleteBlocked = false;
    assert.match(toasts.at(-1), /Pull to refresh/);
    const afterLastDelete = requests.slice(requests.lastIndexOf('DELETE /rest/v1/user_verses') + 1);
    assert.ok(afterLastDelete.includes('GET /rest/v1/user_verses mastered'), 'mastered read again after the failed collapse');
    assert.ok(afterLastDelete.includes('GET /rest/v1/verse_collections'), 'verses read again after the failed collapse');
  });

  await t.test('F35: a translation change tells which verses stayed, but not after a switch during its reread', async (scenario) => {
    const { Alert } = await import('react-native');
    const alerts = [];
    scenario.mock.method(Alert, 'alert', (...args) => alerts.push(args));
    // Matthew 17:21 isn't in the ESV, so the change keeps it in the NIV.
    const omitted = (id) => ({ ...verse(id, 'NIV', false), book: 'Matthew', chapter: 17, verse_start: 21, verse_end: 21 });
    const change = async (id, during) => {
      useAppStore.setState({ bibleVersion: 'NIV' });
      profile = 'NIV';
      identityRows = [omitted(id)];
      heldLinks = Promise.withResolvers();
      requests.length = 0;
      const changing = state().setBibleVersion('ESV');
      for (let i = 0; i < 1000 && !requests.includes('GET /rest/v1/verse_collections'); i++) await new Promise((resolve) => setTimeout(resolve, 1));
      during();
      heldLinks.resolve();
      heldLinks = undefined;
      await changing;
    };
    await change('kept-1', () => {});
    assert.equal(alerts.length, 1, 'the same account is told');
    await change('kept-2', () => state().clear());
    assert.equal(alerts.length, 1, 'nothing shown after the account changed');
  });
});
