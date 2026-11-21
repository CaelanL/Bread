import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareIntroVideo } from '../lib/intro/preparation.ts';

function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return t.mock.method(globalThis, 'clearTimeout');
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('successful native preparation stays paused/muted and clears its deadline', async (t) => {
  const cleared = clock(t);
  const events = [];
  await prepareIntroVideo({
    async unloadAsync() { events.push('unload'); return { isLoaded: false }; },
    async loadAsync(source, status) { events.push({ source, status }); return { isLoaded: true }; },
  }, 42, new AbortController().signal, () => true);
  assert.deepEqual(events, ['unload', { source: 42, status: { shouldPlay: false, isMuted: true } }]);
  assert.equal(cleared.mock.calls.length, 1);
  t.mock.timers.tick(20_000);
  await flush(); assert.equal(events.length, 2);
});

test('a hung native unload times out, cleans up, and cannot later start loading', async (t) => {
  const cleared = clock(t);
  const held = Promise.withResolvers();
  let unloads = 0; let loads = 0;
  const preparing = prepareIntroVideo({
    unloadAsync() { unloads++; return held.promise; },
    async loadAsync() { loads++; return { isLoaded: true }; },
  }, 42, new AbortController().signal, () => true);
  const rejected = assert.rejects(preparing, /timed out/);
  t.mock.timers.tick(15_000); await rejected;
  assert.equal(unloads, 2); assert.equal(loads, 0); assert.equal(cleared.mock.calls.length, 1);
  held.resolve({ isLoaded: false }); await flush();
  assert.equal(loads, 0);
});

test('a hung native load is bounded and its late completion cannot affect a successful retry', async (t) => {
  clock(t);
  const held = Promise.withResolvers();
  let unloads = 0; let loads = 0; let request = 1;
  const video = {
    async unloadAsync() { unloads++; return { isLoaded: false }; },
    loadAsync() { loads++; return loads === 1 ? held.promise : Promise.resolve({ isLoaded: true }); },
  };
  const preparing = prepareIntroVideo(video, 'file:///missing.mp4', new AbortController().signal, () => request === 1);
  const rejected = assert.rejects(preparing, /timed out/);
  await flush(); assert.equal(loads, 1);
  t.mock.timers.tick(14_999); await flush(); assert.equal(unloads, 1);
  t.mock.timers.tick(1); await rejected; assert.equal(unloads, 2);
  request = 2;
  await prepareIntroVideo(video, 42, new AbortController().signal, () => request === 2);
  held.resolve({ isLoaded: true }); await flush(); t.mock.timers.tick(20_000); await flush();
  assert.equal(unloads, 3); assert.equal(loads, 2);
});

test('canceling preparation clears its timer and blocks late native work or cleanup of a new owner', async (t) => {
  const cleared = clock(t);
  const held = Promise.withResolvers(); const abort = new AbortController();
  let unloads = 0; let loads = 0;
  const preparing = prepareIntroVideo({
    unloadAsync() { unloads++; return held.promise; },
    async loadAsync() { loads++; return { isLoaded: true }; },
  }, 42, abort.signal, () => true);
  const rejected = assert.rejects(preparing, /canceled/);
  abort.abort(); await rejected; assert.equal(cleared.mock.calls.length, 1);
  held.resolve({ isLoaded: false }); await flush(); t.mock.timers.tick(20_000); await flush();
  assert.equal(unloads, 1); assert.equal(loads, 0);
});

test('native failure and stale-owner deadlines never authorize later playback', async (t) => {
  clock(t);
  const failure = prepareIntroVideo({
    async unloadAsync() { return { isLoaded: false }; },
    async loadAsync() { throw new Error('Native failure.'); },
  }, 42, new AbortController().signal, () => true);
  await assert.rejects(failure, /Native failure/);
  const held = Promise.withResolvers(); let current = true; let unloads = 0;
  const stale = prepareIntroVideo({
    unloadAsync() { unloads++; return held.promise; },
    async loadAsync() { throw new Error('Must not load stale source.'); },
  }, 42, new AbortController().signal, () => current);
  const rejected = assert.rejects(stale, /timed out/);
  current = false; t.mock.timers.tick(15_000); await rejected;
  assert.equal(unloads, 1);
  held.resolve({ isLoaded: false }); await flush(); assert.equal(unloads, 1);
});
