import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const collectionsPath = '/rest/v1/user_collections';
const copyPath = '/rest/v1/rpc/copy_verse_to_collection';
const reorderPath = '/rest/v1/rpc/reorder_collections';
const versesPath = '/rest/v1/verse_collections';
const createdAt = '2026-11-10T00:00:00Z';
const responseError = () => Response.json({ message: 'Write failed' }, { status: 400 });
const membership = (account) => ({
  added_at: createdAt,
  user_collections: { client_id: 'my-verses' },
  user_verses: {
    client_id: account + '-verse',
    book: 'John',
    chapter: 3,
    verse_start: 16,
    verse_end: 16,
    version: 'ESV',
    progress: { hard: { bestAccuracy: 95, completed: true } },
  },
});

test('collection writes stay with the account that started them', async (t) => {
  // Supply only the native platform and storage boundaries to the real app modules.
  const fixture = mkdtempSync(join(tmpdir(), 'bread-library-test-'));
  const platformFile = join(fixture, 'platform.cjs');
  const storageFile = join(fixture, 'storage.cjs');
  writeFileSync(platformFile, 'exports.Platform = { OS: "ios" };');
  writeFileSync(storageFile, `
      const values = new Map();
      module.exports = {
        async getItem(key) { return values.get(key) ?? null; },
        async setItem(key, value) { values.set(key, value); },
        async removeItem(key) { values.delete(key); },
      };
    `);
  const native = {
    'react-native': platformFile,
    '@react-native-async-storage/async-storage': storageFile,
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(native, specifier)) {
        return { url: pathToFileURL(native[specifier]).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  t.after(() => {
    hooks.deregister();
    rmSync(fixture, { recursive: true, force: true });
  });

  const tokens = Object.fromEntries(['A', 'B'].map((account) => [
    account, 'e30.' + Buffer.from(JSON.stringify({ sub: account })).toString('base64url') + '.AA',
  ]));
  const held = [];
  const hold = (path, method = 'POST') => {
    const request = Promise.withResolvers();
    const response = Promise.withResolvers();
    held.push({ path, method, request, response });
    return { sent: request.promise, reply: response.resolve };
  };
  let collectionReads = 0;
  let copyWrites = 0;

  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(input).pathname;
    const method = init?.method ?? 'GET';
    const bearer = new Headers(init?.headers).get('Authorization');
    const account = Object.keys(tokens).find((key) => bearer === 'Bearer ' + tokens[key]);
    if (path === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({
        access_token: tokens[id], refresh_token: 'refresh-' + id, token_type: 'bearer',
        expires_in: 3600, user: { id },
      });
    }
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (path === '/auth/v1/user') return Response.json({ id: account });
    if (path === collectionsPath && method === 'GET') collectionReads++;
    if (path === copyPath) copyWrites++;

    const index = held.findIndex((entry) => entry.path === path && entry.method === method);
    if (index >= 0) {
      const [entry] = held.splice(index, 1);
      entry.request.resolve(account);
      return entry.response.promise;
    }
    if (path === collectionsPath && method === 'GET') {
      return Response.json(['first', 'second'].map((id) => ({
        client_id: id, name: account + ' ' + id, is_default: false, created_at: createdAt,
      })));
    }
    throw new Error('Unexpected request: ' + method + ' ' + path);
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const store = useAppStore.getState;
  t.after(() => supabase.auth.stopAutoRefresh());

  async function signIn(account) {
    assert.ifError((await supabase.auth.signOut({ scope: 'local' })).error);
    store().clear();
    assert.ifError((await supabase.auth.signInWithPassword({
      email: account + '@example.test', password: 'test',
    })).error);
  }

  await t.test('clearing the store during session lookup cancels the pending copy', async (scenario) => {
    await signIn('A');
    const session = await supabase.auth.getSession();
    const lookup = Promise.withResolvers();
    scenario.mock.method(supabase.auth, 'getSession', () => lookup.promise, { times: 1 });
    const before = copyWrites;
    const copying = store().copyVerseToCollection('A-verse', 'my-verses');
    await signIn('B');
    lookup.resolve(session);
    await copying;
    assert.equal(copyWrites, before);
    assert.deepEqual(store().verses, []);
  });

  await t.test('a late copy cannot populate the next account or suppress its verse load', async () => {
    await signIn('A');
    const copy = hold(copyPath);
    const copying = store().copyVerseToCollection('A-verse', 'my-verses');
    assert.equal(await copy.sent, 'A');
    await signIn('B');
    const read = hold(versesPath, 'GET');
    const loading = store().fetchVerses();
    assert.equal(await read.sent, 'B');
    copy.reply(Response.json(membership('A')));
    await copying;
    const whileLoading = store().verses.map((verse) => verse.id);
    read.reply(Response.json([membership('B')]));
    await loading;
    assert.deepEqual(whileLoading, []);
    assert.deepEqual(store().verses.map((verse) => verse.id), ['B-verse']);
  });

  await t.test('a late rename cannot rename the next account’s matching collection ID', async () => {
    await signIn('A');
    await store().fetchCollections();
    const rename = hold(collectionsPath, 'PATCH');
    const renaming = store().renameCollection('first', 'A renamed');
    assert.equal(await rename.sent, 'A');
    await signIn('B');
    await store().fetchCollections();
    rename.reply(Response.json({ name: 'A renamed' }));
    await renaming;
    assert.equal(store().collections.find((c) => c.id === 'first')?.name, 'B first');
  });

  for (const staleResult of ['success', 'failure']) {
    await t.test('a late reorder ' + staleResult + ' cannot unlock or refresh the next account', async () => {
      await signIn('A');
      await store().fetchCollections();
      const oldSave = hold(reorderPath);
      const oldAction = store().reorderCollections(['second', 'first']).then(() => null, (error) => error);
      assert.equal(await oldSave.sent, 'A');
      await signIn('B');
      await store().fetchCollections();
      const readsBefore = collectionReads;
      const newSave = hold(reorderPath);
      const newAction = store().reorderCollections(['second', 'first']);
      assert.equal(await newSave.sent, 'B');
      oldSave.reply(staleResult === 'success' ? new Response(null, { status: 204 }) : responseError());
      const error = await oldAction;
      const whileSaving = store().collectionOrderSaving;
      const reads = collectionReads;
      newSave.reply(new Response(null, { status: 204 }));
      await newAction;
      assert.equal(error, null);
      assert.equal(whileSaving, true);
      assert.equal(reads, readsBefore);
      assert.equal(store().collectionOrderSaving, false);
      assert.deepEqual(store().collections.slice(-2).map((c) => c.name), ['B second', 'B first']);
    });
  }

  await t.test('a refresh from a failed reorder cannot change the next account’s loading state', async () => {
    await signIn('A');
    await store().fetchCollections();
    const save = hold(reorderPath);
    const retryRead = hold(collectionsPath, 'GET');
    const reordering = store().reorderCollections(['second', 'first']).then(() => null, (error) => error);
    assert.equal(await save.sent, 'A');
    save.reply(responseError());
    assert.equal(await retryRead.sent, 'A');
    await signIn('B');
    const newRead = hold(collectionsPath, 'GET');
    const loading = store().fetchCollections();
    assert.equal(await newRead.sent, 'B');
    retryRead.reply(responseError());
    const error = await reordering;
    const beforeBResponse = { loading: store().collectionsLoading, error: store().error };
    newRead.reply(Response.json([]));
    await loading;
    assert.equal(error, null);
    assert.deepEqual(beforeBResponse, { loading: true, error: null });
  });
});
