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
    'react-native': file('platform.cjs', 'exports.Platform = { OS: "android" }; exports.Alert = { alert() {} }; exports.Linking = {}; globalThis.requestIdleCallback = () => 0;'),
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
  const hold = (path, query, method) => {
    const request = Promise.withResolvers();
    const response = Promise.withResolvers();
    held.push({ path, query, method, request, response });
    return { sent: request.promise, reply: response.resolve };
  };
  let offline = false;
  let profileFails = false;
  let profileMissing = false;
  let seedFails = false;
  let shared = null;
  const verseRows = { A: [membership('A')], B: [membership('B')] };
  // The server's mastered rows, kept up to date by progress saves.
  const masteredRows = { A: [], B: [] };
  // Replies for the next progress saves, ahead of the default (applied as sent).
  const progressReplies = [];
  const requests = [];
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    requests.push(url.pathname);
    const method = init.method ?? 'GET';
    sent.push(method + ' ' + url.pathname);
    const bearer = new Headers(init.headers).get('Authorization');
    const account = Object.keys(tokens).find((key) => bearer === 'Bearer ' + tokens[key]);
    const object = new Headers(init.headers).get('Accept')?.includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({ access_token: tokens[id], refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 3600, user: { id } });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    const index = held.findIndex((entry) => entry.path === url.pathname && (!entry.query || url.search.includes(entry.query))
      && (entry.method ? method === entry.method : method === 'GET' || url.pathname.startsWith('/rest/v1/rpc/')));
    if (index >= 0) {
      const [entry] = held.splice(index, 1);
      entry.request.resolve(account);
      return entry.response.promise;
    }
    if (offline) throw new TypeError('Network request failed');
    if (url.pathname === '/rest/v1/rpc/save_verse_progress' && progressReplies.length) return Response.json(progressReplies.shift());
    if (url.pathname === '/rest/v1/rpc/save_verse_progress') {
      const body = JSON.parse(init.body);
      if (body.p_progress?.hard?.completed) {
        masteredRows[account] = [{ ...membership(account, body.p_client_id).user_verses, progress: body.p_progress, created_at: '2026-11-10T00:00:00Z' }];
      }
      return Response.json([{ applied: true, progress: body.p_progress, last_practiced_at: body.p_last_practiced_at, updated_at: '2026-11-14T00:00:00.000001+00:00' }]);
    }
    if (url.pathname === '/rest/v1/rpc/get_shared_status') return Response.json(shared ? [shared.status] : []);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
    if (seedFails && url.pathname === '/rest/v1/profiles' && method === 'POST') return Response.json({ message: 'unavailable' }, { status: 503 });
    if (method !== 'GET') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      if (profileFails) return Response.json({ message: 'unavailable' }, { status: 503 });
      if (profileMissing) return Response.json([]);
      const row = { translation: 'ESV', display_name: account + ' L.', first_name: account, last_name: 'L', welcome_v2_seen_at: null };
      return Response.json(object ? row : [row]);
    }
    if (url.pathname === '/rest/v1/user_collections') {
      return Response.json([{ client_id: 'my-verses', name: 'My Verses', is_default: true, created_at: '2026-11-01T00:00:00Z' },
        { client_id: 'psalms', name: 'Psalms', is_default: false, created_at: '2026-11-02T00:00:00Z' }]);
    }
    if (url.pathname === '/rest/v1/verse_collections') return Response.json(verseRows[account]);
    if (url.pathname === '/rest/v1/user_verses' && url.search.includes('completed=eq.true')) return Response.json(masteredRows[account]);
    if (url.pathname === '/rest/v1/shared_collections') return Response.json(shared ? [shared.group] : []);
    if (url.pathname === '/rest/v1/shared_collection_members') return Response.json(shared ? [shared.mine] : []);
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
    // The library reads go out first, and the saved library paints while they're in flight.
    requests.length = 0;
    const wave = hold('/rest/v1/verse_collections');
    const collections = hold('/rest/v1/user_collections');
    setAccount('A');
    await Promise.all([wave.sent, collections.sent]);
    await until(() => store().hydrated);
    assert.equal(store().hydratedFrom, 'snapshot');
    assert.deepEqual(store().verses.map((v) => v.id), ['A-snap']);
    assert.deepEqual(store().collections.map((c) => c.id), ['my-verses', 'mastered', 'in-progress']);
    assert.equal(store().displayName, 'A L.');
    assert.equal(store().synced, false);
    const before = storage.get('library_snapshot:A');
    collections.reply(Response.json([{ client_id: 'my-verses', name: 'My Verses', is_default: true, created_at: '2026-11-01T00:00:00Z' }]));
    wave.reply(Response.json(verseRows.A));
    await until(() => store().synced);
    assert.equal(store().hydratedFrom, 'server');
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse']);
    assert.equal(requests.filter((path) => path === '/rest/v1/verse_collections').length, 1, 'a read started before the paint still applies');
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

  await t.test('a launch still restoring with nothing saved shows the library empty with the load error, and starts when the session is back', async () => {
    const { subscribeToToast } = await import('../lib/toast.ts');
    const toasts = [];
    const unsubscribe = subscribeToToast((message) => toasts.push(message));
    setAccount(null);
    setAccount('A', { provisional: true });
    await store().showOffline('A');
    unsubscribe();
    assert.equal(store().hydrated, true);
    assert.deepEqual(store().verses, []);
    assert.deepEqual(toasts, ['Some data failed to load. Pull to refresh.']);
    setAccount('A');
    await until(() => store().synced);
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse']);
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
  const startSynced = async (account) => {
    setAccount(null);
    await signIn(account);
    setAccount(account);
    await until(() => store().synced);
  };
  const easy = { bestAccuracy: null, completed: false };

  await t.test('a failed profile read leaves synced false, so name and translation decisions wait for it', async () => {
    verseRows.A = [membership('A')];
    setAccount(null);
    await signIn('A');
    profileFails = true;
    setAccount('A');
    await until(() => store().hydratedFrom === 'server');
    assert.equal(store().synced, false, 'the library reads worked, the profile read did not');
    assert.equal(await store().whenSynced(), false);
    profileFails = false;
    assert.equal(await store().whenSynced(), true, 'the retry reads the profile');
    assert.equal(store().firstName, 'A');
  });

  await t.test("a missing profile whose seeding fails isn't loaded, and leaves synced false", async () => {
    setAccount(null);
    await signIn('A');
    profileMissing = true;
    seedFails = true;
    setAccount('A');
    await until(() => store().hydratedFrom === 'server');
    assert.equal(store().synced, false);
    assert.equal(store().profileLoaded, false);
    seedFails = false;
    assert.equal(await store().whenSynced(), true, 'the retry seeds it');
    assert.equal(store().profileLoaded, true);
    profileMissing = false;
  });

  await t.test("a progress save that lands after a switch to B touches nothing of B's", async () => {
    await startSynced('A');
    const done = { bestAccuracy: 95, completed: true };
    useAppStore.setState((state) => ({
      verses: state.verses.map((v) => ({ ...v, progress: { easy, medium: easy, hard: done } })),
      masteredVerses: [],
    }));
    const save = hold('/rest/v1/rpc/save_verse_progress');
    const saving = store().updateVerseProgress('A-verse', 'easy', 100);
    await save.sent;
    await startSynced('B');
    save.reply(Response.json([{ applied: true, progress: { easy: done, medium: easy, hard: done }, last_practiced_at: null, updated_at: '2026-11-14T00:00:02.000001+00:00' }]));
    await saving;
    assert.deepEqual(store().masteredVerses.map((v) => v.id), []);
    assert.equal(store().lastSessionAt, null);
    masteredRows.A = [];
  });

  await t.test('a confirmed write during a pending delete saves no snapshot without the verse; the failed delete leaves it in', async () => {
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await store().addCollection('Psalms 2');
    assert.ok(saved('A').verses.some((v) => v.id === 'A-verse'), 'not saved while the delete is pending');
    remove.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(deleting);
    assert.ok(saved('A').verses.some((v) => v.id === 'A-verse'));
    assert.ok(saved('A').collections.some((c) => c.name === 'Psalms 2'), 'the confirmed add is saved once the delete settles');
  });

  await t.test('an older mastered read never removes a mastery saved during it', async () => {
    setAccount(null);
    await signIn('A');
    storage.set('library_snapshot:A', painted('A', 'A-verse'));
    const mastered = hold('/rest/v1/user_verses', 'completed=eq.true');
    setAccount('A');
    await mastered.sent;
    await until(() => store().hydratedFrom === 'snapshot' && !store().versesLoading);
    await store().updateVerseProgress('A-verse', 'hard', 95);
    assert.deepEqual(store().masteredVerses.map((v) => v.id), ['A-verse']);
    mastered.reply(Response.json([]));
    await until(() => store().synced);
    assert.deepEqual(store().masteredVerses.map((v) => v.id), ['A-verse']);
    assert.deepEqual(saved('A').masteredVerses.map((v) => v.id), ['A-verse']);
  });

  await t.test('a progress reset is in the snapshot as soon as it succeeds', async () => {
    assert.deepEqual(saved('A').masteredVerses.map((v) => v.id), ['A-verse']);
    masteredRows.A = [];
    await store().resetVerseProgress('A-verse');
    assert.deepEqual(saved('A').masteredVerses, []);
    assert.equal(saved('A').verses.find((v) => v.id === 'A-verse').progress.hard.completed, false);
  });

  await t.test('a translation change saves the snapshot once its verses are reread', async () => {
    storage.set('library_snapshot:A', 'before');
    await store().setBibleVersion('NIV');
    assert.notEqual(storage.get('library_snapshot:A'), 'before');
    await store().setBibleVersion('ESV');
  });

  await t.test("Stop sharing counts the others from the server's library, read after the wait", async () => {
    const { Alert } = await import('react-native');
    const { confirmStopSharing } = await import('../components/shared/member-actions.ts');
    const alerts = [];
    t.mock.method(Alert, 'alert', (...args) => alerts.push(args));
    const group = { id: 'g1', ownerName: null, name: 'Psalms', role: 'owner', memberCount: 1, verseCount: 0, masteredSquares: 0, engravedSquares: 0 };
    // Saved: the owner is alone. On the server, someone has since joined.
    shared = {
      group: { id: 'g1', name: 'Psalms' },
      mine: { shared_collection_id: 'g1', role: 'owner' },
      status: { shared_id: 'g1', member_count: 2, verse_count: 0, mastered_squares: 0, engraved_squares: 0 },
    };
    setAccount(null);
    storage.set('library_snapshot:A', serializeSnapshot({
      collections: [{ id: 'my-verses', name: 'My Verses', isDefault: true, createdAt: 0 }],
      verses: [membershipVerse('A-verse')], masteredVerses: [], sharedCollections: { g1: group },
      displayName: 'A L.', firstName: 'A', lastName: 'L',
    }, Date.now()));
    const wave = hold('/rest/v1/verse_collections');
    // The group's count is still the saved 1 when Stop sharing is tapped.
    const status = hold('/rest/v1/rpc/get_shared_status');
    setAccount('A');
    await Promise.all([wave.sent, status.sent]);
    await until(() => store().hydratedFrom === 'snapshot');
    assert.equal(store().sharedCollections.g1.memberCount, 1);
    const confirming = confirmStopSharing('g1', 'Psalms', null, 'A');
    status.reply(Response.json([shared.status]));
    wave.reply(Response.json(verseRows.A));
    await confirming;
    assert.equal(alerts.length, 1);
    assert.match(alerts[0][1], /The other member will keep their own copy/);
    Alert.alert.mock.restore();
    shared = null;
  });

  await t.test('Home reloads when a session save lands while it is focused', async () => {
    const fixtureHooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const stub = { react: 'react-stub.cjs', 'expo-router/react-navigation': 'navigation-stub.cjs', '@/hooks/use-resume': 'resume-stub.cjs' }[specifier];
        return stub && context.parentURL?.endsWith('use-home-reload.ts')
          ? { url: pathToFileURL(join(fixture, stub)).href, shortCircuit: true }
          : nextResolve(specifier, context);
      },
    });
    file('react-stub.cjs', 'exports.useRef = (current) => ({ current }); exports.useCallback = (f) => f;');
    // Focused until the cleanup the effect returned is called.
    file('navigation-stub.cjs', 'exports.useFocusEffect = (effect) => { globalThis.blurHome = effect(); };');
    file('resume-stub.cjs', 'exports.useResume = () => {};');
    const { useHomeReload } = await import('../hooks/use-home-reload.ts');
    fixtureHooks.deregister();
    await startSynced('A');
    let reloads = 0;
    useHomeReload('A', async () => { reloads++; return true; });
    await until(() => reloads === 1);
    const save = hold('/rest/v1/rpc/save_verse_progress');
    const saving = store().updateVerseProgress('A-verse', 'easy', 40);
    await save.sent;
    save.reply(Response.json([{ applied: true, progress: { easy: { bestAccuracy: 40, completed: false }, medium: easy, hard: easy }, last_practiced_at: null, updated_at: '2026-11-14T00:00:03.000001+00:00' }]));
    await saving;
    await until(() => reloads === 2);
    globalThis.blurHome();
  });
  await t.test('a failed delete puts back only its verse: a progress save on another verse meanwhile stays, in memory and on disk', async () => {
    verseRows.A = [membership('A'), membership('A', 'A-two')];
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await store().updateVerseProgress('A-two', 'easy', 60);
    remove.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(deleting);
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse', 'A-two']);
    assert.equal(store().verses[1].progress.easy.bestAccuracy, 60);
    assert.equal(saved('A').verses.find((v) => v.id === 'A-two').progress.easy.bestAccuracy, 60);
    assert.ok(saved('A').verses.some((v) => v.id === 'A-verse'));
  });

  await t.test('a failed collection sort puts back only that sort: a collection added meanwhile stays, in memory and on disk', async () => {
    const update = hold('/rest/v1/user_collections', null, 'PATCH');
    const sorting = store().setCollectionSort('psalms', 'alphabetical');
    await update.sent;
    await store().addCollection('Later');
    update.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await sorting;
    assert.ok(store().collections.some((c) => c.name === 'Later'));
    assert.equal(store().collections.find((c) => c.id === 'psalms').sortPreference, undefined);
    assert.ok(saved('A').collections.some((c) => c.name === 'Later'));
  });
  await t.test("a session's attempt row landing after its progress save marks a session again, so Home's streak reloads", async () => {
    const { logSessionAttempt } = await import('../lib/api/analytics.ts');
    const insert = hold('/rest/v1/session_attempts', null, 'POST');
    const logging = logSessionAttempt({
      book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, version: 'ESV', difficulty: 'easy', chunkSize: 1, accuracy: 80,
    });
    await insert.sent;
    await store().updateVerseProgress('A-two', 'easy', 61);
    const afterSave = store().lastSessionAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    insert.reply(new Response(null, { status: 201 }));
    await logging;
    assert.ok(store().lastSessionAt > afterSave);
  });
  await t.test("opening or pulling a shared collection saves what it read, for the next offline launch", async () => {
    await startSynced('A');
    // Another member added a verse; this device's copy gets it on the next open.
    verseRows.A = [...verseRows.A, membership('A', 'A-from-group')];
    await store().openSharedCollection('g1', { pull: true });
    assert.ok(store().verses.some((v) => v.id === 'A-from-group'));
    assert.ok(saved('A').verses.some((v) => v.id === 'A-from-group'));
  });
  await t.test('a failed delete adds nothing back that a read during it already put back', async () => {
    verseRows.A = [membership('A'), membership('A', 'A-two')];
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await store().fetchVerses();
    remove.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(deleting);
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse', 'A-two']);
  });

  await t.test('a save retried from a reset on another device takes the verse out of Mastered, in memory and on disk', async () => {
    const done = { bestAccuracy: 95, completed: true };
    useAppStore.setState((state) => ({
      verses: state.verses.map((v) => v.id === 'A-verse' ? { ...v, progress: { easy: done, medium: done, hard: done } } : v),
      masteredVerses: [{ ...state.verses[0], collectionId: 'mastered', progress: { easy: done, medium: done, hard: done } }],
    }));
    progressReplies.push([{ applied: false, progress: { easy, medium: easy, hard: easy }, last_practiced_at: null, updated_at: '2026-11-14T00:00:04.000001+00:00' }]);
    await store().updateVerseProgress('A-verse', 'easy', 70);
    assert.equal(store().verses[0].progress.hard.completed, false);
    assert.deepEqual(store().masteredVerses.map((v) => v.id), []);
    assert.deepEqual(saved('A').masteredVerses, []);
  });
  // ---- Round 4: the three rules, each through several actions ----

  await t.test("rule 1: A's late answers (a reset's rollback, a sort's rollback, an add) never touch B", async () => {
    verseRows.A = [membership('A'), membership('A', 'A-two')];
    await startSynced('A');
    const reset = hold('/rest/v1/user_verses', null, 'PATCH');
    const sort = hold('/rest/v1/user_collections', null, 'PATCH');
    const add = hold('/rest/v1/user_collections', null, 'POST');
    const resetting = store().resetVerseProgress('A-verse');
    const sorting = store().setCollectionSort('psalms', 'alphabetical');
    const adding = store().addCollection('Late A');
    await Promise.all([reset.sent, sort.sent, add.sent]);
    await startSynced('B');
    const before = JSON.stringify({ verses: store().verses, mastered: store().masteredVerses, collections: store().collections });
    reset.reply(Response.json({ message: 'nope' }, { status: 400 }));
    sort.reply(Response.json({ message: 'nope' }, { status: 400 }));
    add.reply(new Response(null, { status: 201 }));
    await Promise.allSettled([resetting, sorting, adding]);
    assert.equal(JSON.stringify({ verses: store().verses, mastered: store().masteredVerses, collections: store().collections }), before);
    assert.equal(saved('B').verses.some((v) => v.id.startsWith('A-')), false);
  });

  await t.test("F31: A's failed delete, answered after a switch to B, puts nothing into B's library", async () => {
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await startSynced('B');
    remove.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(deleting);
    assert.deepEqual(store().verses.map((v) => v.id), ['B-verse']);
  });

  await t.test('F32: a delete that succeeds after a read during it still has the verse gone, in memory and on disk', async () => {
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await store().fetchVerses();
    assert.deepEqual(store().verses.map((v) => v.id), ['A-two'], 'the read leaves the pending delete out');
    remove.reply(new Response(null, { status: 204 }));
    await deleting;
    assert.deepEqual(store().verses.map((v) => v.id), ['A-two']);
    assert.deepEqual(saved('A').verses.map((v) => v.id), ['A-two']);
  });

  await t.test('rule 2: a pull to refresh and a shared open during a delete keep it out; its failure puts it back once', async () => {
    await startSynced('A');
    const remove = hold('/rest/v1/rpc/delete_verse');
    const deleting = store().deleteVerse('A-verse', 'my-verses');
    await remove.sent;
    await store().refresh();
    await store().openSharedCollection('g1');
    assert.deepEqual(store().verses.map((v) => v.id), ['A-two']);
    remove.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(deleting);
    assert.deepEqual(store().verses.map((v) => v.id), ['A-verse', 'A-two']);
  });

  const writePaths = ['/rest/v1/rpc/join_shared_collection', '/rest/v1/rpc/share_collection', '/rest/v1/rpc/add_verse',
    '/rest/v1/rpc/sync_shared_collection', '/rest/v1/rpc/import_curated_collection', '/functions/v1/bible', '/rest/v1/rpc/copy_verse_to_collection'];
  const writesSent = () => requests.filter((path) => writePaths.includes(path));

  await t.test('rule 3: join, share, add and a curated import wait for the profile before writing', async () => {
    setAccount(null);
    await signIn('A');
    const profileRead = hold('/rest/v1/profiles');
    setAccount('A');
    await profileRead.sent;
    requests.length = 0;
    const actions = [
      store().joinSharedCollection('ABCD-EFGH'),
      store().shareCollection('psalms'),
      store().addVerse({ book: 'John', chapter: 1, verseStart: 1, verseEnd: 1 }, 'my-verses'),
      store().importCuratedCollection('hope'),
    ];
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(writesSent(), [], 'nothing written, or read in a translation, on the saved profile');
    profileRead.reply(Response.json([{ translation: 'ESV', display_name: 'A L.', first_name: 'A', last_name: 'L', welcome_v2_seen_at: null }]));
    await Promise.allSettled(actions);
    for (const path of writePaths.slice(0, 3)) assert.ok(writesSent().includes(path), path);
    assert.ok(writesSent().includes('/functions/v1/bible'), 'the import checks its passages once the translation is known');
  });

  await t.test('F38: a copy into a personal collection links the existing row, so it does not wait for the profile', async () => {
    setAccount(null);
    await signIn('A');
    const profileRead = hold('/rest/v1/profiles');
    setAccount('A');
    await profileRead.sent;
    requests.length = 0;
    const copying = store().copyVerseToCollection('A-verse', 'psalms').catch(() => {});
    await until(() => writesSent().includes('/rest/v1/rpc/copy_verse_to_collection'));
    profileRead.reply(Response.json([{ translation: 'ESV', display_name: 'A L.', first_name: 'A', last_name: 'L', welcome_v2_seen_at: null }]));
    await Promise.allSettled([copying]);
  });

  // Each write pins its account before its first wait: a switch during the session lookup sends nothing.
  for (const [name, start, write] of [
    ['setName', () => store().setName('Late', 'A'), 'POST /rest/v1/profiles'],
    ['setBibleVersion', () => store().setBibleVersion('NIV'), 'POST /rest/v1/profiles'],
    ['addCollection', () => store().addCollection('Late A'), 'POST /rest/v1/user_collections'],
  ]) {
    await t.test(`F36: ${name} started for A sends nothing once B is signed in`, async (scenario) => {
      await startSynced('A');
      const session = await supabase.auth.getSession();
      const lookup = Promise.withResolvers();
      let asked = false;
      scenario.mock.method(supabase.auth, 'getSession', () => { asked = true; return lookup.promise; }, { times: 1 });
      const running = start();
      await until(() => asked);
      // B's start queues behind a translation change, so the lookup answers before B is synced.
      setAccount(null);
      await signIn('B');
      setAccount('B');
      sent.length = 0;
      lookup.resolve(session);
      await Promise.allSettled([running]);
      await until(() => store().synced);
      assert.deepEqual(sent.filter((request) => request === write), []);
    });
  }

  await t.test('F37: a failed reset puts back only its own progress, and no entry deleted during it', async () => {
    const done = { bestAccuracy: 95, completed: true };
    const practiced = (collection) => ({ ...membership('A'), user_collections: { client_id: collection },
      user_verses: { ...membership('A').user_verses, progress: { easy: done } } });
    verseRows.A = [practiced('my-verses'), practiced('psalms'), membership('A', 'A-two')];
    await startSynced('A');
    const reset = hold('/rest/v1/user_verses', null, 'PATCH');
    const firstDelete = hold('/rest/v1/rpc/delete_verse');
    const pendingDelete = hold('/rest/v1/rpc/delete_verse');
    const resetting = store().resetVerseProgress('A-verse');
    await reset.sent;
    const deletingTwo = store().deleteVerse('A-two', 'my-verses');
    await firstDelete.sent;
    const deletingPsalm = store().deleteVerse('A-verse', 'psalms');
    await pendingDelete.sent;
    firstDelete.reply(new Response(null, { status: 204 }));
    await deletingTwo;
    reset.reply(Response.json({ message: 'nope' }, { status: 400 }));
    await assert.rejects(resetting);
    const entries = () => store().verses.map((v) => v.id + '|' + v.collectionId);
    assert.deepEqual(entries(), ['A-verse|my-verses'], 'neither the deleted nor the pending entry came back');
    assert.equal(store().verses[0].progress.easy.completed, true, 'its own progress is back');
    pendingDelete.reply(new Response(null, { status: 204 }));
    await deletingPsalm;
    assert.deepEqual(entries(), ['A-verse|my-verses']);
    assert.deepEqual(saved('A').verses.map((v) => v.id + '|' + v.collectionId), ['A-verse|my-verses']);
  });

  await t.test("F30: opening a shared collection syncs its copy only once the account's translation is known", async () => {
    setAccount(null);
    await signIn('A');
    const profileRead = hold('/rest/v1/profiles');
    setAccount('A');
    await profileRead.sent;
    requests.length = 0;
    const opening = store().openSharedCollection('g1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(writesSent(), []);
    profileRead.reply(Response.json([{ translation: 'ESV', display_name: 'A L.', first_name: 'A', last_name: 'L', welcome_v2_seen_at: null }]));
    await opening;
    assert.deepEqual(writesSent(), ['/rest/v1/rpc/sync_shared_collection']);
  });
});
