import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('community saver reads use authoritative totals and stay with their account', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-savers-test-'));
  const platform = join(fixture, 'platform.cjs');
  const storage = join(fixture, 'storage.cjs');
  writeFileSync(platform, 'exports.Platform = { OS: "ios" };');
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

  const tokens = Object.fromEntries(['A', 'B'].map((account) => [
    account, 'e30.' + Buffer.from(JSON.stringify({ sub: account })).toString('base64url') + '.AA',
  ]));
  const countsPath = '/rest/v1/rpc/get_curated_collection_saver_counts';
  const held = [];
  const events = [];
  let total = 0;
  let failCounts = false;
  let failReadback = false;
  let heldReadback;
  const hold = () => {
    const sent = Promise.withResolvers();
    const result = Promise.withResolvers();
    held.push({ sent, result });
    return { sent: sent.promise, reply: result.resolve };
  };
  const countResponse = (count) => Response.json([{ catalog_id: 'hope', saver_count: count }]);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(input).pathname;
    const bearer = new Headers(init?.headers).get('Authorization');
    const account = Object.keys(tokens).find((id) => bearer === 'Bearer ' + tokens[id]);
    if (path === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({ access_token: tokens[id], refresh_token: 'refresh-' + id,
        token_type: 'bearer', expires_in: 3600, user: { id } });
    }
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (path === '/auth/v1/user') return Response.json({ id: account });
    if (path === countsPath) {
      events.push('counts');
      const pending = held.shift();
      if (pending) { pending.sent.resolve(account); return pending.result.promise; }
      return failCounts ? Response.json({ message: 'Unavailable' }, { status: 503 }) : countResponse(total);
    }
    if (path === '/rest/v1/rpc/import_curated_collection') {
      events.push('import');
      return Response.json('saved-collection');
    }
    if (path === '/rest/v1/user_collections') {
      events.push('readback');
      assert.ok(failReadback, 'This boundary fixture only expects failed readback.');
      if (heldReadback) return heldReadback.promise;
      return Response.json({ message: 'Unavailable' }, { status: 403 });
    }
    throw new Error('Unexpected request: ' + path);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const state = useAppStore.getState;
  t.after(() => supabase.auth.stopAutoRefresh());
  async function signIn(account) {
    assert.ifError((await supabase.auth.signOut({ scope: 'local' })).error);
    state().clear();
    assert.ifError((await supabase.auth.signInWithPassword({ email: account + '@example.test', password: 'test' })).error);
  }

  await t.test('initial failure is unknown, a successful zero is zero, and refresh failure keeps known data', async () => {
    await signIn('A');
    failCounts = true;
    assert.equal(await state().fetchCuratedSaverCounts(), false);
    assert.equal(state().curatedSaverCounts.hope, undefined);
    failCounts = false;
    assert.equal(await state().fetchCuratedSaverCounts(), true);
    assert.equal(state().curatedSaverCounts.hope, 0);
    total = 4;
    await state().fetchCuratedSaverCounts();
    failCounts = true;
    await state().fetchCuratedSaverCounts();
    assert.equal(state().curatedSaverCounts.hope, 4);
    assert.equal(state().error, null);
    failCounts = false;
  });
  await t.test('a slow older response cannot overwrite a newer total', async () => {
    await signIn('A');
    const first = hold();
    const firstRead = state().fetchCuratedSaverCounts();
    await first.sent;
    const second = hold();
    const secondRead = state().fetchCuratedSaverCounts();
    await second.sent;
    second.reply(countResponse(6));
    await secondRead;
    first.reply(countResponse(5));
    assert.equal(await firstRead, false);
    assert.equal(state().curatedSaverCounts.hope, 6);
  });
  await t.test('leaving a screen prevents its late read from publishing', async () => {
    await signIn('A');
    const controller = new AbortController();
    const read = hold();
    const pending = state().fetchCuratedSaverCounts(controller.signal);
    await read.sent;
    controller.abort();
    read.reply(countResponse(8));
    assert.equal(await pending, false);
    assert.equal(state().curatedSaverCounts.hope, undefined);
  });
  await t.test('sign-out clears totals and an old account cannot repopulate the next account', async () => {
    await signIn('A');
    const read = hold();
    const pending = state().fetchCuratedSaverCounts();
    assert.equal(await read.sent, 'A');
    await signIn('B');
    assert.equal(state().curatedSaverCounts.hope, undefined);
    total = 9;
    await state().fetchCuratedSaverCounts();
    read.reply(countResponse(8));
    assert.equal(await pending, false);
    assert.equal(state().curatedSaverCounts.hope, 9);
  });
  await t.test('a committed import refreshes totals while readback is pending, without incrementing locally', async () => {
    await signIn('A');
    total = 12;
    await state().fetchCuratedSaverCounts();
    events.length = 0;
    failReadback = true;
    heldReadback = Promise.withResolvers();
    const read = hold();
    let importFinished = false;
    const importing = state().importCuratedCollection('hope', 'KJV').then((result) => {
      importFinished = true;
      return result;
    });
    assert.equal(await read.sent, 'A');
    assert.equal(state().curatedSaverCounts.hope, 12);
    read.reply(countResponse(12));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(importFinished, false);
    assert.equal(state().curatedSaverCounts.hope, 12);
    heldReadback.resolve(Response.json({ message: 'Unavailable' }, { status: 403 }));
    heldReadback = undefined;
    const result = await importing;
    assert.deepEqual(result, { collectionId: 'curated-hope-KJV', loaded: false });
    assert.equal(state().curatedSaverCounts.hope, 12);
    assert.equal(events[0], 'import');
    assert.deepEqual(events.slice(1).sort(), ['counts', 'readback']);
  });
  await t.test('count failure never turns a committed save into a failed import', async () => {
    await signIn('A');
    failCounts = true;
    assert.deepEqual(await state().importCuratedCollection('hope', 'KJV'), {
      collectionId: 'curated-hope-KJV', loaded: false,
    });
    assert.equal(state().curatedSaverCounts.hope, undefined);
  });
});
