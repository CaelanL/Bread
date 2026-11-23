import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real store's updateVerseProgress against a stubbed save_verse_progress that behaves like the
// migration: it applies only on a matching updated_at and otherwise returns the server's row.
test('progress saves land only on the row they were computed from', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-progress-guard-'));
  writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform = { OS: "ios" }; exports.Alert = { alert() {} }; globalThis.requestIdleCallback = () => 0;');
  writeFileSync(join(fixture, 'storage.cjs'), 'const values=new Map();module.exports={async getItem(k){return values.get(k)??null},async setItem(k,v){values.set(k,v)},async removeItem(k){values.delete(k)}};');
  const native = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  let server;
  let tick = 0;
  let racing = false;
  const saves = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/token') {
      return Response.json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    }
    if (url.pathname === '/rest/v1/rpc/save_verse_progress') {
      const body = JSON.parse(init.body);
      saves.push(body);
      // Another device saves between every read and write.
      if (racing) server = { ...server, updated_at: `2026-11-14T00:00:0${++tick}.000001+00:00` };
      if (body.p_expected_updated_at !== server.updated_at) return Response.json([{ applied: false, ...server }]);
      server = {
        progress: body.p_progress ?? server.progress,
        last_practiced_at: body.p_last_practiced_at,
        updated_at: `2026-11-14T00:00:0${++tick}.000001+00:00`,
      };
      return Response.json([{ applied: true, ...server }]);
    }
    return Response.json([]);
  });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { useAppStore } = await import('../lib/store/index.ts');
  const { supabase } = await import('../lib/api/client.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ok((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).data.session);
  const state = useAppStore.getState;

  const level = (bestAccuracy) => ({ bestAccuracy, completed: bestAccuracy !== null && bestAccuracy >= 90 });
  const engraved = (passCount) => ({
    completed: false, passCount, lifetimeReviews: passCount, months: [], nextDueAt: '2026-11-01T00:00:00.000Z',
    lastReviewedAt: '2026-10-01T00:00:00.000Z', currentIntervalDays: 7,
  });
  const inMemory = (progress, updatedAt) => useAppStore.setState({
    verses: [{ id: 'v1', collectionId: 'my-verses', book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, version: 'ESV',
      createdAt: 0, progress, updatedAt }],
    masteredVerses: [],
  });

  await t.test('a stale base is refused, and the session is recomputed from the server row', async () => {
    saves.length = 0;
    server = {
      progress: { easy: level(100), medium: level(100), hard: level(95), engraved: engraved(5) },
      last_practiced_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00.123456+00:00',
    };
    inMemory({ easy: level(100), medium: level(100), hard: level(80), engraved: engraved(0) }, '2026-11-01T00:00:00.000001+00:00');

    await state().updateVerseProgress('v1', 'hard', 90, true);
    assert.equal(saves.length, 2);
    assert.equal(saves[0].p_progress.hard.bestAccuracy, 90, 'the first try was computed from memory');
    assert.equal(saves[1].p_expected_updated_at, '2026-11-13T00:00:00.123456+00:00', 'the retry uses the server row to the microsecond');
    assert.equal(server.progress.hard.bestAccuracy, 95, 'no lower best is written');
    assert.ok(server.progress.engraved.passCount >= 5, 'the server\'s engraved passes are kept');
    const saved = state().verses[0];
    assert.deepEqual(saved.progress, server.progress);
    assert.equal(saved.updatedAt, server.updated_at);
    assert.deepEqual(state().masteredVerses.map((v) => v.id), ['v1'], 'mastered on the server, so on the Mastered list');
  });

  await t.test('a fresh base saves once', async () => {
    saves.length = 0;
    inMemory(state().verses[0].progress, server.updated_at);
    await state().updateVerseProgress('v1', 'easy', 50, false);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].p_progress, null, 'no new best: progress stays, the practice time is saved');
    assert.equal(server.last_practiced_at, state().verses[0].lastPracticedAt);
  });

  await t.test('refused twice: the save fails for the caller\'s toast', async () => {
    saves.length = 0;
    racing = true;
    await assert.rejects(state().updateVerseProgress('v1', 'hard', 99, true), /Failed to save progress/);
    racing = false;
    assert.equal(saves.length, 2);
  });
});
