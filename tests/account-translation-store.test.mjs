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

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  const progress = (mastered) => ({
    easy: { bestAccuracy: 95, completed: true },
    medium: { bestAccuracy: mastered ? 95 : null, completed: mastered },
    hard: { bestAccuracy: mastered ? 95 : null, completed: mastered },
  });
  const verse = (id, version, mastered) => ({ id, client_id: id, book: 'John', chapter: 3, verse_start: 16, verse_end: 16,
    version, progress: progress(mastered), deleted_at: null });
  let profile = 'NIV';
  let heldProfile;
  let failLinks = false;
  const writes = [];
  const json = (body, status = 200) => Response.json(body, { status });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const object = new Headers(init.headers).get('Accept')?.includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    }
    if (url.pathname === '/auth/v1/user') return json({ id: 'A' });
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      if (method !== 'GET') {
        writes.push(['profile', JSON.parse(init.body).translation]);
        profile = JSON.parse(init.body).translation;
        return new Response(null, { status: 201 });
      }
      if (heldProfile) await heldProfile.promise;
      const row = { translation: profile };
      return json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/user_verses' && method === 'GET' && url.searchParams.get('select')?.startsWith('id,client_id')) {
      return json([verse('esv-row', 'ESV', true), verse('niv-row', 'NIV', false)]);
    }
    if (url.pathname === '/rest/v1/verse_collections' && url.searchParams.get('select') === 'collection_id,added_at') {
      return failLinks ? json({ message: 'unavailable' }, 503) : json([]);
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
    toasts.length = 0;
    await state().refresh();
    assert.deepEqual(toasts, []);
    assert.deepEqual(writes.filter(([method]) => method === 'DELETE'), [['DELETE', '/rest/v1/user_verses', 'in.(niv-row)']]);
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
});
