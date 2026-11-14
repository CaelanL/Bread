import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Soniox's socket, driven by the test: open, message, error, close.
class FakeSocket {
  static all = [];
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.sent = [];
    FakeSocket.all.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  reply(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) await settle();
  assert.ok(condition(), 'timed out waiting');
}

test('live transcription keys and fallback', { timeout: 15000 }, async (t) => {
  // Supply only the native platform and storage boundaries to the real app modules.
  const fixture = mkdtempSync(join(tmpdir(), 'bread-live-test-'));
  writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform = { OS: "ios" };');
  writeFileSync(join(fixture, 'storage.cjs'), 'const values=new Map();module.exports={async getItem(k){return values.get(k)??null},async setItem(k,v){values.set(k,v)},async removeItem(k){values.delete(k)}};');
  const native = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  const realSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => {
    globalThis.WebSocket = realSocket;
    hooks.deregister();
    rmSync(fixture, { recursive: true, force: true });
  });
  t.mock.method(console, 'log', () => {});

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  let mints = 0;
  let gate = null;
  let refuse = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const path = new URL(input).pathname;
    if (path === '/auth/v1/token') return Response.json({ access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    if (path !== '/functions/v1/transcription-token') throw new Error('Unexpected request: ' + path);
    const n = ++mints;
    if (gate) await gate.promise;
    if (refuse) return Response.json({ error: 'LIVE_DISABLED' }, { status: 403 });
    return Response.json({ apiKey: `key-${n}`, expiresAt: null, websocketUrl: 'wss://soniox.test/transcribe', model: 'stt-rt-v5' });
  });
  const { supabase } = await import('../lib/api/client.ts');
  const { LiveStandby, startLiveTranscription } = await import('../lib/transcription/live-session.ts');
  const { scoreRecording } = await import('../lib/transcription/score-recording.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'a@example.test', password: 'test' })).error);

  // Spares off, as in the background, so each tap opens its own socket
  function quiet() {
    const standby = new LiveStandby();
    standby.sleep();
    return standby;
  }

  async function open(keys) {
    const before = FakeSocket.all.length;
    const session = startLiveTranscription('be still', keys);
    await until(() => FakeSocket.all.length > before);
    return { session, socket: FakeSocket.all.at(-1) };
  }

  function stream(socket) {
    socket.onopen();
    return socket;
  }

  t.beforeEach(() => {
    mints = 0;
    gate = null;
    refuse = false;
  });

  await t.test('one key serves every recording on the screen', async () => {
    const keys = quiet();
    void keys.get();
    const first = await open(keys);
    stream(first.socket);
    first.session.abort();
    const second = await open(keys);
    assert.equal(mints, 1);
    assert.equal(second.socket.protocols[1], 'key-1');
    second.session.abort();
  });

  await t.test('the key goes in the socket protocols, never in the config frame', async () => {
    const { session, socket } = await open(quiet());
    assert.deepEqual(socket.protocols, ['soniox-api-key', 'key-1']);
    stream(socket);
    const config = JSON.parse(socket.sent[0]);
    assert.equal(config.model, 'stt-rt-v5');
    assert.equal('api_key' in config, false);
    session.abort();
  });

  await t.test('a key that Soniox accepted is kept after a silent take falls back', async () => {
    const keys = quiet();
    const first = await open(keys);
    stream(first.socket);
    first.session.feedAudio(new Uint8Array(320));
    const finishing = first.session.finish(1500);
    first.socket.reply({ tokens: [], finished: true });
    await assert.rejects(finishing, /empty transcript/);
    (await open(keys)).session.abort();
    assert.equal(mints, 1);
  });

  await t.test('a key is minted again once it is 30s short of its 300s life', async (scenario) => {
    scenario.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const keys = quiet();
    (await open(keys)).session.abort();
    scenario.mock.timers.tick(269_999);
    (await open(keys)).session.abort();
    assert.equal(mints, 1);
    scenario.mock.timers.tick(1);
    const late = await open(keys);
    assert.equal(mints, 2);
    assert.equal(late.socket.protocols[1], 'key-2');
    late.session.abort();
  });

  await t.test('a tap during the opening mint waits for that mint', async () => {
    gate = Promise.withResolvers();
    const keys = quiet();
    void keys.get();
    const before = FakeSocket.all.length;
    const first = startLiveTranscription('be still', keys);
    const second = startLiveTranscription('be still', keys);
    await until(() => mints === 1);
    gate.resolve();
    await until(() => FakeSocket.all.length === before + 2);
    assert.equal(mints, 1);
    first.abort();
    second.abort();
  });

  await t.test('a socket that fails before Soniox answers drops its key', async () => {
    const keys = quiet();
    const first = await open(keys);
    first.socket.onerror();
    assert.equal(first.session.state, 'failed');
    const next = await open(keys);
    assert.equal(mints, 2);
    assert.equal(next.socket.protocols[1], 'key-2');
    next.session.abort();
  });

  await t.test('a live finish that stalls hands the file to batch after 1.5s', async (scenario) => {
    const { session, socket } = await open(quiet());
    stream(socket);
    session.feedAudio(new Uint8Array(320));
    scenario.mock.timers.enable({ apis: ['setTimeout'] });
    let uploaded = false;
    const scoring = scoreRecording({
      text: 'be still',
      isRetry: false,
      isPeeked: false,
      isCurrent: () => true,
      liveSession: session,
      async transcribeFile() {
        uploaded = true;
        return 'be still';
      },
    });
    scenario.mock.timers.tick(1499);
    await settle();
    assert.equal(uploaded, false);
    assert.equal(socket.sent.at(-1), '', 'end-of-audio was sent');
    scenario.mock.timers.tick(1);
    await settle();
    assert.equal(uploaded, true);
    assert.equal((await scoring)?.display.score, 100);
  });

  function score(session, upload) {
    return scoreRecording({
      text: 'be still',
      isRetry: false,
      isPeeked: false,
      isCurrent: () => true,
      liveSession: session,
      transcribeFile: upload,
    });
  }

  await t.test('a socket that never opened sends the file to batch at once', async (scenario) => {
    const { session, socket } = await open(quiet());
    session.feedAudio(new Uint8Array(320));
    scenario.mock.timers.enable({ apis: ['setTimeout'] });
    let uploaded = false;
    const result = await score(session, async () => {
      uploaded = true;
      return 'be still';
    });
    assert.equal(uploaded, true);
    assert.equal(result?.display.score, 100);
    assert.equal(socket.sent.length, 0);
  });

  await t.test('a trailing chunk that lands during the grace window still counts', async (scenario) => {
    const { session, socket } = await open(quiet());
    stream(socket);
    scenario.mock.timers.enable({ apis: ['setTimeout'] });
    const scoring = score(session, async () => assert.fail('live should score this take'));
    session.feedAudio(new Uint8Array(320));
    scenario.mock.timers.tick(50);
    assert.equal(socket.sent.at(-1), '', 'end-of-audio was sent');
    socket.reply({ tokens: [{ text: 'be still', is_final: true }], finished: true });
    assert.equal((await scoring)?.display.score, 100);
  });

  await t.test('no audio by the end of the grace window goes to batch', async (scenario) => {
    const { session, socket } = await open(quiet());
    stream(socket);
    scenario.mock.timers.enable({ apis: ['setTimeout'] });
    let uploaded = false;
    const scoring = score(session, async () => {
      uploaded = true;
      return 'be still';
    });
    scenario.mock.timers.tick(49);
    await settle();
    assert.equal(uploaded, false);
    scenario.mock.timers.tick(1);
    assert.equal((await scoring)?.display.score, 100);
    assert.equal(uploaded, true);
  });

  async function spareOf(standby) {
    const before = FakeSocket.all.length;
    standby.warm();
    await until(() => FakeSocket.all.length > before);
    return FakeSocket.all.at(-1);
  }

  await t.test('a tap streams into the spare opened with the screen', async () => {
    const standby = new LiveStandby();
    const spare = stream(await spareOf(standby));
    const before = FakeSocket.all.length;
    const session = startLiveTranscription('be still', standby);
    assert.equal(FakeSocket.all.length, before);
    assert.equal(JSON.parse(spare.sent[0]).context.text, 'be still');
    session.feedAudio(new Uint8Array(320));
    assert.equal(spare.sent[1].byteLength, 320);
    session.abort();
    await until(() => FakeSocket.all.length === before + 1);
    standby.dispose();
    assert.equal(FakeSocket.all.at(-1).closed, true);
  });

  await t.test('a tap while the spare is still connecting uses it', async () => {
    const standby = new LiveStandby();
    const spare = await spareOf(standby);
    const before = FakeSocket.all.length;
    const session = startLiveTranscription('be still', standby);
    stream(spare);
    assert.equal(FakeSocket.all.length, before);
    assert.equal(session.state, 'streaming');
    assert.equal(JSON.parse(spare.sent[0]).model, 'stt-rt-v5');
    standby.dispose();
    session.abort();
  });

  await t.test('the spare sends keepalives until a tap sends config', async (scenario) => {
    scenario.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const standby = new LiveStandby();
    const spare = stream(await spareOf(standby));
    scenario.mock.timers.tick(10_000);
    assert.deepEqual(spare.sent.map((frame) => JSON.parse(frame)), [{ type: 'keepalive' }]);
    const session = startLiveTranscription('be still', standby);
    scenario.mock.timers.tick(40_000);
    assert.deepEqual(spare.sent.slice(1).map((frame) => JSON.parse(frame).type), [undefined]);
    standby.dispose();
    session.abort();
  });

  await t.test('the spare closes in the background and on leaving, and reopens on return', async () => {
    const standby = new LiveStandby();
    const first = stream(await spareOf(standby));
    standby.sleep();
    assert.equal(first.closed, true);
    const second = await spareOf(standby);
    standby.dispose();
    assert.equal(second.closed, true);
    const before = FakeSocket.all.length;
    standby.replenish();
    await settle();
    assert.equal(FakeSocket.all.length, before);
  });

  await t.test('a dropped spare reopens once with a fresh key, then waits for a tap', async () => {
    const standby = new LiveStandby();
    const first = await spareOf(standby);
    first.onclose();
    await until(() => FakeSocket.all.at(-1) !== first);
    const second = FakeSocket.all.at(-1);
    assert.equal(second.protocols[1], 'key-2');
    const before = FakeSocket.all.length;
    second.onerror();
    await settle();
    assert.equal(FakeSocket.all.length, before);
    standby.dispose();
  });

  await t.test('the spare is replaced with a fresh key before its key goes stale', async (scenario) => {
    scenario.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.now() });
    const standby = new LiveStandby();
    standby.warm();
    await until(() => mints === 1 && FakeSocket.all.at(-1).protocols[1] === 'key-1');
    const first = stream(FakeSocket.all.at(-1));
    scenario.mock.timers.tick(270_000);
    assert.equal(first.closed, true);
    await until(() => FakeSocket.all.at(-1).protocols[1] === 'key-2');
    standby.dispose();
  });

  await t.test('a tap never takes a spare whose key went stale', async (scenario) => {
    scenario.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const standby = new LiveStandby();
    const spare = stream(await spareOf(standby));
    scenario.mock.timers.tick(270_000);
    const session = startLiveTranscription('be still', standby);
    assert.equal(spare.closed, true);
    await until(() => FakeSocket.all.at(-1).protocols[1] === 'key-2');
    assert.equal(spare.sent.length, 0);
    standby.dispose();
    session.abort();
  });

  await t.test('with live turned off there is no spare and one mint per tap', async () => {
    refuse = true;
    const standby = new LiveStandby();
    const before = FakeSocket.all.length;
    standby.warm();
    await until(() => mints === 1);
    const session = startLiveTranscription('be still', standby);
    await until(() => session.state === 'failed');
    await settle();
    assert.equal(mints, 2);
    assert.equal(FakeSocket.all.length, before);
    standby.dispose();
  });
});
