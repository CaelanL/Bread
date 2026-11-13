import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('identical Bible reads in progress share one request', { timeout: 15000 }, async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-bible-in-flight-'));
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
  const requests = [];
  let gate = null;
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    if (url.pathname !== '/functions/v1/bible') throw new Error('Unexpected request: ' + url.pathname);
    const ref = url.searchParams.get('ref'); const version = url.searchParams.get('version');
    const chapter = url.searchParams.get('chapter') === 'true';
    requests.push(`${chapter ? 'chapter' : 'verse'} ${ref} ${version}`);
    if (gate) await gate.promise;
    if (fail) return Response.json({ error: 'Unavailable' }, { status: 503 });
    if (chapter) return Response.json({ reference: ref, version, verses: { 1: `${version} one`, 2: `${version} two` }, cached: false });
    const [, start, end] = ref.match(/:(\d+)(?:-(\d+))?$/);
    const verses = {};
    for (let n = Number(start); n <= Number(end ?? start); n++) verses[n] = `${version} ${n}`;
    return Response.json({ reference: ref, version, text: Object.values(verses).join(' '), verses, cached: false });
  });
  const { supabase } = await import('../lib/api/client.ts');
  const { fetchVerse, fetchChapter, clearSessionCache } = await import('../lib/api/bible.ts');
  assert.ok((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).data.session);
  t.after(() => supabase.auth.stopAutoRefresh());
  const reset = () => { requests.length = 0; gate = Promise.withResolvers(); fail = false; clearSessionCache(); };

  await t.test('three simultaneous reads of one cold passage make one request', async () => {
    reset();
    const reads = [fetchVerse('John 3:16-17', 'ESV'), fetchVerse('John 3:16-17', 'ESV'), fetchVerse('John 3:16-17', 'ESV')];
    gate.resolve();
    const results = await Promise.all(reads);
    assert.deepEqual(requests, ['verse John 3:16-17 ESV']);
    for (const result of results) assert.deepEqual(result.verses, { 16: 'ESV 16', 17: 'ESV 17' });
  });

  await t.test('three simultaneous reads of one cold chapter make one request', async () => {
    reset();
    const reads = [fetchChapter('John', 3, 'ESV'), fetchChapter('John', 3, 'ESV'), fetchChapter('John', 3, 'ESV')];
    gate.resolve();
    await Promise.all(reads);
    assert.deepEqual(requests, ['chapter John 3 ESV']);
  });

  await t.test('translations, ranges, and chapter versus passage never share', async () => {
    reset();
    const reads = [
      fetchVerse('John 3:16', 'ESV'), fetchVerse('John 3:16', 'NLT'),
      fetchVerse('John 3:16-17', 'ESV'), fetchChapter('John', 3, 'NLT'),
    ];
    gate.resolve();
    const [esv, nlt, range] = await Promise.all(reads);
    assert.deepEqual(requests.sort(), ['chapter John 3 NLT', 'verse John 3:16 ESV', 'verse John 3:16 NLT', 'verse John 3:16-17 ESV']);
    assert.equal(esv.text, 'ESV 16'); assert.equal(nlt.text, 'NLT 16'); assert.equal(range.text, 'ESV 16 ESV 17');
  });

  await t.test('a failure reaches every waiting caller, and a retry fetches again', async () => {
    reset(); fail = true;
    const reads = [fetchVerse('Romans 8:28', 'ESV'), fetchVerse('Romans 8:28', 'ESV')];
    gate.resolve();
    for (const read of reads) await assert.rejects(read, /Unavailable/);
    assert.equal(requests.length, 1);
    fail = false;
    assert.equal((await fetchVerse('Romans 8:28', 'ESV')).text, 'ESV 28');
    assert.equal(requests.length, 2);
  });

  await t.test('clearing the session cache mid-request neither duplicates nor strands it', async () => {
    reset();
    const first = fetchVerse('Psalms 23:1', 'ESV');
    clearSessionCache();
    const second = fetchVerse('Psalms 23:1', 'ESV');
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
    clearSessionCache();
    await fetchVerse('Psalms 23:1', 'ESV');
    assert.equal(requests.length, 2);
  });
});
