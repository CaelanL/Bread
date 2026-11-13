import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// lib/welcome.ts against a stubbed Supabase REST boundary: a claim won while an invite takes the
// screen is still there to peek at afterwards, and peeking never claims.
test('welcome claim and peek', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-welcome-test-'));
  writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform = { OS: "ios" };');
  writeFileSync(join(fixture, 'storage.cjs'), 'const values=new Map();module.exports={async getItem(k){return values.get(k)??null},async setItem(k,v){values.set(k,v)},async removeItem(k){values.delete(k)}};');
  const native = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';

  const unseen = new Set(['A', 'B']);
  const claims = [];
  let gate = null;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname !== '/rest/v1/profiles' || init.method !== 'PATCH') throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
    const user = url.searchParams.get('user_id').replace('eq.', '');
    claims.push(user);
    if (gate) await gate.promise;
    const won = unseen.delete(user);
    return Response.json(won ? [{ user_id: user }] : []);
  });
  const { claimWelcome, peekWelcome, markWelcomeShown } = await import('../lib/welcome.ts');

  await t.test('peeking before any claim answers false and claims nothing', async () => {
    assert.equal(await peekWelcome('A'), false);
    assert.deepEqual(claims, []);
    assert.ok(unseen.has('A'));
  });

  await t.test('a claim won while an invite took the screen is still there to peek at', async () => {
    gate = Promise.withResolvers();
    claimWelcome('A'); // the invite lands: nobody awaits this claim
    gate.resolve();
    assert.equal(await peekWelcome('A'), true);
    assert.deepEqual(claims, ['A']);
    gate = null;
  });

  await t.test('once the walkthrough opens, peek and claim answer false without a request', async () => {
    markWelcomeShown('A');
    assert.equal(await peekWelcome('A'), false);
    assert.equal(await claimWelcome('A'), false);
    assert.deepEqual(claims, ['A']);
  });

  await t.test('a claim the server refuses (already seen) peeks false', async () => {
    assert.equal(await claimWelcome('C'), false);
    assert.equal(await peekWelcome('C'), false);
  });
});
