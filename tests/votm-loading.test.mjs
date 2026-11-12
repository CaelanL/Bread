import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('monthly loads publish reference metadata promptly and keep text with its current version/month', { timeout: 15000 }, async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-votm-loading-'));
  writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform = { OS: "ios" };');
  writeFileSync(join(fixture, 'storage.cjs'), 'const values=new Map();module.exports={async getItem(k){return values.get(k)??null},async setItem(k,v){values.set(k,v)},async removeItem(k){values.delete(k)}};');
  const native = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  let book = 'Psalms';
  let failMetadata = false;
  let emptyMetadata = false;
  let failText = false;
  let failCount = false;
  const held = new Map();
  const monthCalls = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    if (url.pathname === '/rest/v1/verse_of_month') {
      const month = url.searchParams.get('year_month').slice(3); monthCalls.push(month);
      if (failMetadata) return Response.json({ message: 'Unavailable' }, { status: 503 });
      if (emptyMetadata) return Response.json(null);
      return Response.json({ id: month, year_month: month, book, chapter: month === '2026-11' ? 23 : 46,
        verse_start: 1, verse_end: 1, image_url: null });
    }
    if (url.pathname === '/rest/v1/rpc/get_votm_mastery_count') return failCount
      ? Response.json({ message: 'Function unavailable' }, { status: 404 }) : Response.json(0);
    if (url.pathname === '/rest/v1/user_verses') return Response.json(null);
    if (url.pathname === '/functions/v1/bible') {
      const version = url.searchParams.get('version'); const reference = url.searchParams.get('ref');
      const pending = held.get(version);
      if (pending) { held.delete(version); pending.sent.resolve(); return pending.reply.promise; }
      if (failText) return Response.json({ error: 'Unavailable' }, { status: 503 });
      return Response.json({ reference, version, text: 'Synthetic ' + version, verses: { 1: 'Synthetic ' + version }, cached: false });
    }
    throw new Error('Unexpected request: ' + url.pathname);
  });
  const { supabase } = await import('../lib/api/client.ts');
  const { clearSessionCache } = await import('../lib/api/bible.ts');
  const { localMonthKey } = await import('../lib/api/votm.ts');
  const { createMonthlyLoader } = await import('../lib/votm/loader.ts');
  assert.ok((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).data.session);
  t.after(() => supabase.auth.stopAutoRefresh());
  const november = new Date(2026, 10, 30, 23, 59);
  const december = new Date(2026, 11, 1, 0, 1);
  const reset = () => { held.clear(); monthCalls.length = 0; book = 'Psalms'; clearSessionCache(); failMetadata = false; emptyMetadata = false; failText = false; failCount = false; };
  const hold = (version) => {
    const pending = { sent: Promise.withResolvers(), reply: Promise.withResolvers() };
    held.set(version, pending); return pending;
  };

  await t.test('local calendar key rolls over locally rather than in UTC', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Auckland';
      const instant = new Date('2026-11-30T12:30:00Z');
      assert.equal(localMonthKey(instant), '2026-12');
      assert.equal(instant.getUTCMonth(), 10);
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  await t.test('metadata appears while text is loading, and a stale translation cannot replace a newer one', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    const pending = hold('ESV'); const old = loader.load('ESV', november); await pending.sent.promise;
    assert.equal(updates.at(-1).loading, false); assert.equal(updates.at(-1).votm.yearMonth, '2026-11');
    assert.equal(updates.at(-1).text, null); assert.equal(updates.at(-1).textLoading, true);
    await loader.load('NLT', november);
    assert.equal(updates.at(-1).text, 'Synthetic NLT');
    pending.reply.resolve(Response.json({ reference: 'Psalms 23:1', version: 'ESV', text: 'Old response', verses: { 1: 'Old response' } }));
    await old; assert.equal(updates.at(-1).text, 'Synthetic NLT');
  });
  await t.test('month changes clear the prior verse immediately and fetch the new month', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    await loader.load('ESV', november);
    assert.equal(updates.at(-1).votm.yearMonth, '2026-11');
    const pending = hold('ESV'); const next = loader.load('ESV', december);
    assert.equal(updates.at(-1).text, null); assert.equal(updates.at(-1).loading, true);
    await pending.sent.promise;
    assert.equal(updates.at(-1).votm.yearMonth, '2026-12'); assert.equal(updates.at(-1).text, null);
    pending.reply.resolve(Response.json({ reference: 'Psalms 46:1', version: 'ESV', text: 'New month', verses: { 1: 'New month' } }));
    await next; assert.equal(updates.at(-1).text, 'New month');
    assert.deepEqual(monthCalls, ['2026-11', '2026-12']);
  });
  await t.test('reloading the month on screen keeps it there, text included, until the new read lands', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    await loader.load('ESV', november);
    const before = updates.length;
    clearSessionCache(); const pending = hold('ESV'); const again = loader.load('ESV', november);
    await pending.sent.promise;
    assert.ok(updates.length > before);
    for (const state of updates.slice(before)) {
      assert.equal(state.loading, false); assert.equal(state.votm.yearMonth, '2026-11'); assert.equal(state.text, 'Synthetic ESV');
    }
    pending.reply.resolve(Response.json({ reference: 'Psalms 23:1', version: 'ESV', text: 'Fresh', verses: { 1: 'Fresh' } }));
    await again; assert.equal(updates.at(-1).text, 'Fresh');
  });
  await t.test('leaving or changing accounts prevents late publication', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    const pending = hold('ESV'); const loading = loader.load('ESV', november); await pending.sent.promise;
    loader.cancel(); const count = updates.length;
    pending.reply.resolve(Response.json({ reference: 'Psalms 23:1', version: 'ESV', text: 'Late response', verses: { 1: 'Late response' } }));
    await loading; assert.equal(updates.length, count);
  });
  await t.test('empty schedule, metadata failure, and text failure stay distinct and never keep old text', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    emptyMetadata = true; await loader.load('ESV', november);
    assert.equal(updates.at(-1).votm, null); assert.equal(updates.at(-1).error, null);
    emptyMetadata = false; failMetadata = true; await loader.load('ESV', november);
    assert.equal(updates.at(-1).loading, false); assert.match(updates.at(-1).error, /this month/);
    failMetadata = false; await loader.load('ESV', november);
    assert.equal(updates.at(-1).text, 'Synthetic ESV');
    clearSessionCache(); failText = true; await loader.load('ESV', november);
    assert.equal(updates.at(-1).text, null); assert.equal(updates.at(-1).textLoading, false);
    assert.match(updates.at(-1).error, /verse text/);
  });
  await t.test('existing Psalm aliases keep their display reference and load canonical bundled text', async () => {
    reset(); book = 'Psalm'; const updates = [];
    await createMonthlyLoader((state) => updates.push(state)).load('KJV', november);
    assert.equal(updates.at(-1).votm.book, 'Psalm');
    assert.equal(updates.at(-1).text, 'The LORD is my shepherd; I shall not want.');
    assert.equal(updates.at(-1).error, null);
  });
  await t.test('an unavailable optional mastery count stays unknown, while a successful zero remains zero', async () => {
    reset(); const updates = []; const loader = createMonthlyLoader((state) => updates.push(state));
    failCount = true; await loader.load('ESV', november);
    assert.equal(updates.at(-1).masteryCount, null);
    assert.equal(updates.at(-1).text, 'Synthetic ESV'); assert.equal(updates.at(-1).error, null);
    failCount = false; await loader.load('ESV', november);
    assert.equal(updates.at(-1).masteryCount, 0);
  });
});
