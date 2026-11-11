import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { INTRO_VIDEO, canUseIntroFixture, introCaption, introMediaForPreview } from '../lib/intro/media.ts';

test('production media remains unconfigured and fixture captions match the original test track', () => {
  assert.equal(INTRO_VIDEO.playback, null);
  for (const [dev, url] of [[false, 'http://127.0.0.1:1'], [true, 'https://example.com'], [true, 'http://192.168.1.2.example.com']]) {
    assert.equal(canUseIntroFixture(dev, url), false);
    assert.equal(introMediaForPreview(dev, url, 'sample', 42), INTRO_VIDEO);
  }
  for (const url of ['http://127.0.0.1:1', 'http://localhost:2', 'http://192.168.1.2:3', 'http://10.0.0.5:3', 'http://172.16.0.2:3']) {
    assert.equal(canUseIntroFixture(true, url), true);
  }
  const media = introMediaForPreview(true, 'http://127.0.0.1:1', 'sample', 42);
  assert.equal(media.playback, 42);
  assert.equal(introMediaForPreview(true, 'http://127.0.0.1:1', 'unavailable', 42).playback, 'file:///bread-intro-unavailable.mp4');
  assert.equal(introCaption(media, 0), '[A soft tone plays]');
  assert.equal(introCaption(media, 3000), '[The tone continues]');
  assert.equal(introCaption(media, 6000), '[The tone fades]');
  assert.equal(introCaption(media, 9000), '');
});

test('intro presentation uses real account-pinned API calls and the native player boundary', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-intro-test-'));
  writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform = { OS: "ios" };');
  writeFileSync(join(fixture, 'storage.cjs'), 'const values = new Map(); module.exports = { async getItem(k){return values.get(k)??null}, async setItem(k,v){values.set(k,v)}, async removeItem(k){values.delete(k)} };');
  const native = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const tokens = Object.fromEntries(['A', 'B'].map((account) => [account,
    'e30.' + Buffer.from(JSON.stringify({ sub: account })).toString('base64url') + '.AA']));
  const refreshedToken = tokens.A.replace('.AA', '.BB');
  const requestTokens = [];
  const ledger = new Set();
  const events = [];
  let failRead = false;
  let dropClaim = false;
  let heldClaim;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    const account = authorization === 'Bearer ' + refreshedToken ? 'A' : Object.keys(tokens).find((id) => authorization === 'Bearer ' + tokens[id]);
    if (url.pathname === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({ access_token: tokens[id], refresh_token: 'refresh-' + id, token_type: 'bearer', expires_in: 3600, user: { id } });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/user_intro_presentations') {
      events.push('read:' + account); requestTokens.push(authorization);
      assert.equal(url.searchParams.get('user_id'), 'eq.' + account);
      if (failRead) return Response.json({ message: 'Unavailable' }, { status: 503 });
      return Response.json(ledger.has(account) ? { intro_id: INTRO_VIDEO.id } : null);
    }
    if (url.pathname === '/rest/v1/rpc/claim_intro_presentation') {
      events.push('claim:' + account); requestTokens.push(authorization);
      assert.equal(JSON.parse(init.body).p_intro_id, INTRO_VIDEO.id);
      const won = !ledger.has(account);
      ledger.add(account);
      if (dropClaim) throw new TypeError('Connection lost after commit.');
      if (heldClaim) { heldClaim.sent.resolve(); await heldClaim.reply.promise; }
      return Response.json(won);
    }
    throw new Error('Unexpected network request: ' + url.pathname);
  });
  const { supabase } = await import('../lib/api/client.ts');
  const { createIntroCoordinator } = await import('../lib/intro/coordinator.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  const signIn = async (id) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: id + '@example.test', password: 'test' });
    assert.ifError(error); return data.session;
  };
  const a = await signIn('A');
  const media = { ...INTRO_VIDEO, playback: 42 };
  let eligible = true;
  let prepare;
  let audio;
  let prepareFailure = false;
  let audioFailure = false;
  const player = {
    async prepare() { events.push('prepare'); if (prepare) await prepare.promise; if (prepareFailure) throw new Error('Bad media'); },
    async configureAudio() { events.push('audio'); if (audio) await audio.promise; if (audioFailure) throw new Error('Audio unavailable'); },
    show() { events.push('show'); },
    close() { events.push('close'); },
  };
  const controller = (session = a, chosen = media) => {
    const getSession = typeof session === 'function' ? session : () => session;
    return createIntroCoordinator(getSession()?.user.id ?? '', getSession, chosen, player, () => eligible);
  };
  const reset = () => { ledger.clear(); events.length = 0; requestTokens.length = 0; eligible = true; failRead = false; dropClaim = false; heldClaim = undefined; prepare = undefined; audio = undefined; prepareFailure = false; audioFailure = false; };

  await t.test('missing playback never reads, claims or shows an empty modal', async () => {
    reset(); assert.equal(await controller(a, INTRO_VIDEO).attempt(), false); assert.deepEqual(events, []);
  });
  await t.test('new or existing accounts prepare/audio/claim before autoplay, then never automatically replay', async () => {
    reset(); const first = controller();
    assert.equal(await first.attempt(), true);
    assert.deepEqual(events, ['read:A', 'prepare', 'audio', 'claim:A', 'show']);
    first.cancel();
    assert.equal(await first.attempt(), false);
    events.length = 0;
    assert.equal(await controller().attempt(), false);
    assert.deepEqual(events, ['read:A']);
  });
  await t.test('read failure suppresses this session without consuming an opportunity', async () => {
    reset(); failRead = true; const first = controller();
    assert.equal(await first.attempt(), false); assert.equal(ledger.size, 0);
    failRead = false; assert.equal(await first.attempt(), false);
    assert.equal(await controller().attempt(), true);
  });
  await t.test('bad media and failed audio setup never claim or display', async () => {
    for (const failure of ['media', 'audio']) {
      reset(); prepareFailure = failure === 'media'; audioFailure = failure === 'audio';
      const first = controller();
      assert.equal(await first.attempt(), false);
      assert.equal(ledger.size, 0); assert.ok(!events.includes('show'));
      prepareFailure = false; audioFailure = false;
      assert.equal(await first.replay(), true);
      assert.equal(ledger.size, 0);
    }
  });
  await t.test('a lost successful claim suppresses auto on this and another device', async () => {
    reset(); dropClaim = true; const first = controller();
    assert.equal(await first.attempt(), false); assert.equal(ledger.has('A'), true); assert.ok(!events.includes('show'));
    dropClaim = false; assert.equal(await first.attempt(), false);
    assert.equal(await controller().attempt(), false);
    assert.equal(await first.replay(), true);
  });
  await t.test('leaving or closing during media preparation prevents a claim', async () => {
    reset(); prepare = Promise.withResolvers(); const first = controller();
    const showing = first.attempt();
    while (!events.includes('prepare')) await new Promise((resolve) => setImmediate(resolve));
    eligible = false; first.cancel(); prepare.resolve();
    assert.equal(await showing, false); assert.equal(ledger.size, 0); assert.ok(!events.includes('show'));
  });
  await t.test('closing during audio setup prevents playback and a claim', async () => {
    reset(); audio = Promise.withResolvers(); const first = controller();
    const showing = first.attempt();
    while (!events.includes('audio')) await new Promise((resolve) => setImmediate(resolve));
    first.cancel(); audio.resolve();
    assert.equal(await showing, false); assert.equal(ledger.size, 0); assert.ok(!events.includes('show'));
  });
  await t.test('network requests stay on the initiating account if the global client changes while media prepares', async () => {
    reset(); prepare = Promise.withResolvers(); const showing = controller().attempt();
    while (!events.includes('prepare')) await new Promise((resolve) => setImmediate(resolve));
    await signIn('B'); prepare.resolve();
    assert.equal(await showing, true);
    assert.equal(ledger.has('A'), true); assert.equal(ledger.has('B'), false);
    assert.ok(events.includes('claim:A')); assert.ok(!events.includes('claim:B'));
  });
  await t.test('account/focus changes between a committed claim and presentation consume the marker but show nothing', async () => {
    reset(); heldClaim = { sent: Promise.withResolvers(), reply: Promise.withResolvers() };
    const first = controller(); const showing = first.attempt(); await heldClaim.sent.promise;
    eligible = false; first.cancel(); heldClaim.reply.resolve();
    assert.equal(await showing, false); assert.equal(ledger.has('A'), true); assert.ok(!events.includes('show'));
    heldClaim = undefined; eligible = true; assert.equal(await controller().attempt(), false);
  });
  await t.test('manual replay needs no server claim, works after dismissal, and does not reset automatic eligibility', async () => {
    reset(); failRead = true; const first = controller();
    assert.equal(await first.replay(), true); first.cancel();
    assert.equal(await first.replay(), true); assert.equal(ledger.size, 0);
    assert.ok(!events.some((event) => event.startsWith('read:') || event.startsWith('claim:')));
    assert.equal(await first.attempt(), false);
  });
  await t.test('an old coordinator cannot read or claim with a newly selected account session', async () => {
    reset(); let session = a; const first = controller(() => session);
    session = await signIn('B'); events.length = 0;
    assert.equal(await first.attempt(), false); assert.deepEqual(events, []); assert.equal(ledger.size, 0);
  });
  await t.test('same-account token refresh preserves presentation and pins each in-flight attempt to its starting token', async () => {
    reset(); let session = a; const first = controller(() => session);
    prepare = Promise.withResolvers(); const showing = first.attempt();
    while (!events.includes('prepare')) await new Promise((resolve) => setImmediate(resolve));
    session = { ...a, access_token: refreshedToken }; prepare.resolve();
    assert.equal(await showing, true);
    assert.deepEqual(requestTokens, ['Bearer ' + tokens.A, 'Bearer ' + tokens.A]);
    assert.equal(await first.attempt(), false);
    assert.ok(!events.includes('close')); assert.equal(events.filter((event) => event === 'show').length, 1);
    events.length = 0; requestTokens.length = 0;
    assert.equal(await controller(() => session).attempt(), false);
    assert.deepEqual(requestTokens, ['Bearer ' + refreshedToken]);
  });
  await t.test('an inactive start gate preserves an already shown intro across reactivation', async () => {
    reset(); const first = controller(); assert.equal(await first.attempt(), true);
    eligible = false; assert.equal(await first.attempt(), false);
    eligible = true; assert.equal(await first.attempt(), false);
    assert.equal(events.filter((event) => event === 'show').length, 1); assert.ok(!events.includes('close'));
    first.cancel(); assert.equal(events.at(-1), 'close');
  });
  await t.test('pending/visible reminders defer autoplay and a late blocker cancels before presentation', async () => {
    reset(); eligible = false; const first = controller();
    assert.equal(await first.attempt(), false); assert.deepEqual(events, []);
    eligible = true; audio = Promise.withResolvers(); const showing = first.attempt();
    while (!events.includes('audio')) await new Promise((resolve) => setImmediate(resolve));
    eligible = false; first.cancel(); audio.resolve();
    assert.equal(await showing, false); assert.equal(ledger.size, 0); assert.ok(!events.includes('show'));
    eligible = true; audio = undefined; assert.equal(await first.attempt(), true);
  });
});

test('transient inactivity pauses/resumes the existing native player without seeking or losing a manual pause', async () => {
  const { createIntroInterruption } = await import('../lib/intro/interruption.ts');
  const events = [];
  const interruption = createIntroInterruption({ async pause() { events.push('pause'); }, async play() { events.push('play'); } });
  interruption.onPlaying(true);
  await interruption.setInactive(true); interruption.onPlaying(false);
  assert.deepEqual(events, ['pause']);
  await interruption.setInactive(false);
  assert.deepEqual(events, ['pause', 'play']);
  interruption.onPlaying(false);
  await interruption.setInactive(true); await interruption.setInactive(false);
  assert.deepEqual(events, ['pause', 'play', 'pause']);
  const pending = Promise.withResolvers();
  const closing = createIntroInterruption({ async pause() { events.push('pending-pause'); await pending.promise; }, async play() { events.push('unexpected-play'); } });
  closing.onPlaying(true); const paused = closing.setInactive(true);
  await new Promise((resolve) => setImmediate(resolve));
  const resumed = closing.setInactive(false); closing.dispose(); pending.resolve();
  await Promise.all([paused, resumed]); assert.ok(!events.includes('unexpected-play'));
});

test('a player that finishes loading while inactive is paused and resumes only after reactivation', async () => {
  const { createIntroInterruption } = await import('../lib/intro/interruption.ts');
  const events = []; let loaded = false;
  const interruption = createIntroInterruption({
    async pause() { events.push('pause'); if (!loaded) throw new Error('Not loaded yet.'); },
    async play() { events.push('play'); },
  });
  await assert.rejects(interruption.setInactive(true), /Not loaded/);
  loaded = true; await interruption.onPlaying(true);
  assert.deepEqual(events, ['pause', 'pause']);
  await interruption.setInactive(false); assert.deepEqual(events, ['pause', 'pause', 'play']);
  const fast = createIntroInterruption({ async pause() { events.push('fast-pause'); }, async play() { events.push('fast-play'); } });
  fast.onPlaying(true);
  await Promise.all([fast.setInactive(true), fast.setInactive(false)]);
  assert.equal(events.at(-1), 'fast-play');
  assert.ok(!events.includes('fast-pause'));
});
