import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real store against a stubbed HTTP boundary (Supabase REST and auth): join, leave, and the
// one notice when a group is gone by the next refresh.
test('joining and leaving a shared collection', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-shared-test-'));
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

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'D' })).toString('base64url') + '.AA';
  const group = 'g-1';
  const copy = { client_id: `shared-${group}`, name: 'Romans 8', is_default: false, created_at: '2026-11-11T00:00:00Z',
    sort_preference: null, icon_key: null, shared_collection_id: group };
  const verse = { id: 'v-1', client_id: 'verse-1', book: 'Romans', chapter: 8, verse_start: 28, verse_end: 28, version: 'NIV',
    progress: { easy: { bestAccuracy: null, completed: false }, medium: { bestAccuracy: null, completed: false },
      hard: { bestAccuracy: null, completed: false } }, deleted_at: null };
  let joined = false;
  let progressFails = false;
  let role = 'member';
  let copyRow = null;
  let referenceRemoved = false;
  let masteredSquares = 0;
  let leaveGate = null;
  let leaveFails = false;
  let syncFails = false;
  const rpcs = [];
  const reads = [];
  const writes = [];
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
      if (name === 'sync_shared_collection' && !joined) return json({ code: '42501', message: 'Not a member' }, 403);
      if (name === 'sync_shared_collection' && syncFails) return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
      if (name === 'join_shared_collection') { joined = true; copyRow = copy; return json(copy.client_id); }
      if (name === 'leave_shared_collection') {
        await leaveGate;
        if (leaveFails) return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
        joined = false;
        copyRow = null;
        return new Response(null, { status: 204 });
      }
      if (name === 'get_shared_members') {
        return json([{ user_id: 'C', display_name: 'Cara', role: 'owner', joined_at: '2026-11-01T00:00:00Z' },
          { user_id: 'D', display_name: 'Dana', role: 'member', joined_at: '2026-11-05T00:00:00Z' }]);
      }
      if (name === 'get_shared_progress') {
        if (progressFails) return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
        return json([{ user_id: 'C', book: 'Romans', chapter: 8, verse_start: 28, verse_end: 28, practiced: true, mastered: true, engraved: false }]);
      }
      if (name === 'get_shared_status') {
        return json(joined ? [{ shared_id: group, member_count: 2, verse_count: 1, mastered_squares: masteredSquares, engraved_squares: 0 }] : []);
      }
      return json([]);
    }
    if (method === 'DELETE' && url.pathname === '/rest/v1/shared_collections') {
      // Dissolve: the FK sets the copy's shared_collection_id to NULL.
      joined = false;
      copyRow = { ...copy, shared_collection_id: null };
      return json([{ id: group }]);
    }
    if (method !== 'GET') {
      writes.push(`${method} ${url.pathname}`);
      return new Response(null, { status: 204 });
    }
    reads.push(url.pathname);
    if (url.pathname === '/rest/v1/profiles') return json({ translation: 'NIV', display_name: 'Dana' });
    if (url.pathname === '/rest/v1/user_collections') return json(copyRow ? [copyRow] : []);
    if (url.pathname === '/rest/v1/shared_collection_verses') {
      return json([{ book: 'Romans', chapter: 8, verse_start: 28, verse_end: 28 }]);
    }
    if (url.pathname === '/rest/v1/shared_collections') return json(joined ? [{ id: group, owner_id: 'C', name: 'Romans 8' }] : []);
    if (url.pathname === '/rest/v1/shared_collection_members') {
      return json(joined ? [{ shared_collection_id: group, role }] : []);
    }
    if (url.pathname === '/rest/v1/verse_collections' && url.searchParams.get('select')?.includes('user_collections')) {
      return json(copyRow && !referenceRemoved ? [{ added_at: '2026-11-11T00:00:00Z', user_collections: { client_id: copy.client_id }, user_verses: verse }] : []);
    }
    return json([]);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  const { subscribeToToast } = await import('../lib/toast.ts');
  const toasts = [];
  t.after(subscribeToToast((message) => toasts.push(message)));
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
    assert.equal(state().sharedCollections[group]?.ownerName, 'Cara');
    assert.equal(state().verses.filter((v) => v.collectionId === copy.client_id).length, 1);
  });

  await t.test('opening syncs once, then reads members, progress, the reference list and the group row', async () => {
    rpcs.length = 0;
    reads.length = 0;
    await state().openSharedCollection(group);
    assert.equal(rpcs[0][0], 'sync_shared_collection');
    assert.deepEqual(rpcs[0][1], { p_shared: group, p_version: 'NIV' });
    assert.deepEqual(rpcs.map(([name]) => name).sort(),
      ['get_shared_members', 'get_shared_members', 'get_shared_progress', 'get_shared_status', 'sync_shared_collection']);
    assert.ok(reads.includes('/rest/v1/shared_collection_verses'));
    const progress = state().sharedProgress[group];
    assert.equal(progress.failed, false);
    assert.deepEqual(progress.members.map((m) => m.displayName), ['Cara', 'Dana']);
    assert.deepEqual(progress.references, [{ book: 'Romans', chapter: 8, verseStart: 28, verseEnd: 28 }]);
    assert.equal(progress.cells[0].mastered, true);
  });

  await t.test('a promotion to editor shows on the next open, with no refresh in between', async () => {
    assert.equal(state().sharedCollections[group]?.role, 'member');
    role = 'editor';
    await state().openSharedCollection(group);
    assert.equal(state().sharedCollections[group]?.role, 'editor');
    role = 'member';
  });

  await t.test('copying a verse into a shared collection you own adds it to the group, then syncs', async () => {
    role = 'owner';
    await state().openSharedCollection(group);
    rpcs.length = 0;
    writes.length = 0;
    await state().copyVerseToCollection('verse-1', copy.client_id);
    assert.deepEqual(writes, ['POST /rest/v1/shared_collection_verses']);
    assert.equal(rpcs[0][0], 'sync_shared_collection');
    assert.ok(!rpcs.some(([name]) => name === 'copy_verse_to_collection'));
    role = 'member';
    await state().openSharedCollection(group);
  });

  await t.test('a failed grid read keeps the last grid and marks it failed; a retry clears it', async () => {
    progressFails = true;
    assert.equal(await state().fetchSharedProgress(group), false);
    assert.equal(state().sharedProgress[group].failed, true);
    assert.equal(state().sharedProgress[group].cells.length, 1);
    progressFails = false;
    assert.equal(await state().fetchSharedProgress(group), true);
    assert.equal(state().sharedProgress[group].failed, false);
  });

  await t.test("mastering a shared verse refetches the group's status for the Library card; practice that masters nothing doesn't", async () => {
    rpcs.length = 0;
    await state().updateVerseProgress('verse-1', 'easy', 60);
    assert.deepEqual(rpcs, []);
    await state().updateVerseProgress('verse-1', 'hard', 95, true);
    assert.deepEqual(rpcs.map(([name]) => name), ['get_shared_status', 'get_shared_members']);
  });

  await t.test("a member's Library delete confirms Leave, and a failed leave toasts leave and keeps the card", async () => {
    const { Alert } = await import('react-native');
    const { confirmRemoveCollection } = await import('../components/shared/member-actions.ts');
    const alerts = [];
    t.mock.method(Alert, 'alert', (...args) => alerts.push(args));
    let kept = 0;

    const loaded = state().sharedCollections;
    useAppStore.setState({ sharedCollections: {} });
    confirmRemoveCollection(copy.client_id, { onKept: () => kept++ });
    assert.deepEqual(alerts, [], 'nothing is offered while the role is unknown');
    useAppStore.setState({ sharedCollections: loaded });

    confirmRemoveCollection(copy.client_id, { onKept: () => kept++ });
    const [title, , buttons] = alerts[0];
    assert.equal(title, 'Leave "Romans 8"?');
    toasts.length = 0;
    leaveFails = true;
    buttons.find((b) => b.text === 'Leave').onPress();
    while (toasts.length === 0) await new Promise((r) => setTimeout(r, 1));
    leaveFails = false;
    assert.deepEqual(toasts, ["Couldn't leave this collection. Try again."]);
    assert.equal(kept, 1);
    assert.ok(state().collections.some((c) => c.id === copy.client_id));
    Alert.alert.mock.restore();
  });

  await t.test("a member's delete is leave: the leave RPC, and the copy leaves the store", async () => {
    rpcs.length = 0;
    await state().deleteCollection(copy.client_id);
    assert.deepEqual(rpcs.map(([name]) => name), ['leave_shared_collection']);
    assert.deepEqual(rpcs[0][1], { p_shared: group });
    assert.equal(state().collections.some((c) => c.id === copy.client_id), false);
    assert.equal(state().verses.some((v) => v.collectionId === copy.client_id), false);
    assert.equal(state().sharedCollections[group], undefined);
    assert.equal(state().sharedProgress[group], undefined);
  });

  await t.test('leaving yourself brings no notice on the next refresh', async () => {
    toasts.length = 0;
    await state().refresh();
    assert.deepEqual(toasts, []);
  });

  await t.test('a group gone with the copy deleted reads as removed, once', async () => {
    await state().joinSharedCollection('BREAD828');
    toasts.length = 0;
    joined = false;
    copyRow = null;
    await state().refresh();
    assert.deepEqual(toasts, ['You were removed from Romans 8.']);
    await state().refresh();
    assert.equal(toasts.length, 1);
  });

  await t.test("a group gone with the copy kept reads as the member's own copy", async () => {
    await state().joinSharedCollection('BREAD828');
    toasts.length = 0;
    joined = false;
    copyRow = { ...copy, shared_collection_id: null };
    await state().refresh();
    assert.deepEqual(toasts, ['Romans 8 is now your own copy.']);
    assert.equal(state().collections.find((c) => c.id === copy.client_id)?.sharedId, undefined);
  });

  await t.test('opening reloads the copy even when sync changed nothing: a reference removed between visits goes', async () => {
    await state().joinSharedCollection('BREAD828');
    assert.equal(state().verses.filter((v) => v.collectionId === copy.client_id).length, 1);
    referenceRemoved = true;
    await state().openSharedCollection(group);
    assert.equal(state().verses.filter((v) => v.collectionId === copy.client_id).length, 0);
    referenceRemoved = false;
  });

  await t.test('a failed sync while still a member stays visible', async () => {
    syncFails = true;
    await assert.rejects(state().openSharedCollection(group));
    syncFails = false;
  });

  await t.test('opening after a removal between visits drops the copy and its shared state, with only the removal notice', async () => {
    assert.equal(await state().openSharedCollection(group), true);
    assert.ok(state().sharedProgress[group]);
    joined = false;
    copyRow = null;
    toasts.length = 0;
    assert.equal(await state().openSharedCollection(group), false);
    assert.deepEqual(toasts, ['You were removed from Romans 8.']);
    assert.equal(state().collections.some((c) => c.id === copy.client_id), false);
    assert.equal(state().sharedCollections[group], undefined);
    assert.equal(state().sharedProgress[group], undefined);
  });

  await t.test("resetting a mastered shared verse refetches the group's status, so the emblem goes", async () => {
    await state().joinSharedCollection('BREAD828');
    masteredSquares = 2;
    await state().updateVerseProgress('verse-1', 'hard', 95, true);
    assert.equal(state().sharedCollections[group]?.masteredSquares, 2);
    masteredSquares = 1;
    await state().resetVerseProgress('verse-1');
    assert.equal(state().sharedCollections[group]?.masteredSquares, 1);
    masteredSquares = 0;
  });

  await t.test("the owner's Stop sharing deletes the group and keeps the collection as a plain one, with no notice", async () => {
    role = 'owner';
    await state().refresh();
    toasts.length = 0;
    await state().stopSharing(group);
    const collection = state().collections.find((c) => c.id === copy.client_id);
    assert.ok(collection, 'the collection stays');
    assert.equal(collection.sharedId, undefined);
    assert.equal(state().sharedCollections[group], undefined);
    assert.equal(state().verses.filter((v) => v.collectionId === copy.client_id).length, 1);
    await state().refresh();
    assert.deepEqual(toasts, []);
    role = 'member';
    copyRow = copy;
    await state().joinSharedCollection('BREAD828');
  });

  await t.test('a leave that completes after the account changed touches nothing of the new session', async () => {
    let release;
    leaveGate = new Promise((resolve) => { release = resolve; });
    rpcs.length = 0;
    const leaving = state().leaveSharedCollection(group);
    while (!rpcs.some(([name]) => name === 'leave_shared_collection')) await new Promise((r) => setTimeout(r, 1));
    state().clear();
    await state().refresh();
    assert.ok(state().collections.some((c) => c.id === copy.client_id));
    release();
    await leaving;
    leaveGate = null;
    assert.ok(state().collections.some((c) => c.id === copy.client_id), 'the new session keeps its collection');
    assert.ok(state().sharedCollections[group], 'and its group');
  });
});
