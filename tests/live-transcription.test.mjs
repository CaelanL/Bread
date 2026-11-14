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
  t.mock.method(globalThis, 'fetch', async (input) => {
    const path = new URL(input).pathname;
    if (path === '/auth/v1/token') return Response.json({ access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    if (path !== '/functions/v1/transcription-token') throw new Error('Unexpected request: ' + path);
    const n = ++mints;
    if (gate) await gate.promise;
    return Response.json({ apiKey: `key-${n}`, expiresAt: null, websocketUrl: 'wss://soniox.test/transcribe', model: 'stt-rt-v5' });
  });
  const { supabase } = await import('../lib/api/client.ts');
  const { LiveKeyCache, startLiveTranscription } = await import('../lib/transcription/live-session.ts');
  const { scoreRecording } = await import('../lib/transcription/score-recording.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'a@example.test', password: 'test' })).error);

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
  });

  await t.test('one key serves every recording on the screen', async () => {
    const keys = new LiveKeyCache();
    keys.warm();
    const first = await open(keys);
    stream(first.socket);
    first.session.abort();
    const second = await open(keys);
    assert.equal(mints, 1);
    assert.equal(second.socket.protocols[1], 'key-1');
    second.session.abort();
  });

  await t.test('the key goes in the socket protocols, never in the config frame', async () => {
    const { session, socket } = await open(new LiveKeyCache());
    assert.deepEqual(socket.protocols, ['soniox-api-key', 'key-1']);
    stream(socket);
    const config = JSON.parse(socket.sent[0]);
    assert.equal(config.model, 'stt-rt-v5');
    assert.equal('api_key' in config, false);
    session.abort();
  });

  await t.test('a key that Soniox accepted is kept after a silent take falls back', async () => {
    const keys = new LiveKeyCache();
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
    const keys = new LiveKeyCache();
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
    const keys = new LiveKeyCache();
    keys.warm();
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
    const keys = new LiveKeyCache();
    const first = await open(keys);
    first.socket.onerror();
    assert.equal(first.session.state, 'failed');
    const next = await open(keys);
    assert.equal(mints, 2);
    assert.equal(next.socket.protocols[1], 'key-2');
    next.session.abort();
  });

  await t.test('a live finish that stalls hands the file to batch after 1.5s', async (scenario) => {
    const { session, socket } = await open(new LiveKeyCache());
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
});
