// lib-ok: Regression coverage for recorder ownership at the native boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveTranscriptionSession } from './live-session';
import { createRecordingControls, type RecordingState } from './recording-controls';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const file = { fileUri: 'file:///recitation.m4a', durationMs: 1200 };

function audio() {
  const counts = { permission: 0, starts: 0, stops: 0, fed: 0, aborts: 0 };
  const live: LiveTranscriptionSession = {
    state: 'connecting',
    feedAudio: () => { counts.fed++; },
    finish: async () => 'be still',
    abort: () => { counts.aborts++; },
  };
  return {
    counts,
    capture: {
      requestPermission: async () => { counts.permission++; return true; },
      start: async () => { counts.starts++; },
      stop: async () => { counts.stops++; return file; },
      openLive: () => live,
    },
  };
}

function controls() {
  const states: RecordingState[] = [];
  return { recorder: createRecordingControls((state) => states.push(state)), states };
}

test('two mic taps during permission and native start produce one recording', async () => {
  const { recorder, states } = controls();
  const { capture, counts } = audio();
  const permission = deferred<boolean>();
  const nativeStart = deferred<void>();
  const startEntered = deferred<void>();
  const start = recorder.start(0, false, {
    ...capture,
    async requestPermission() {
      await capture.requestPermission();
      return permission.promise;
    },
    async start() {
      await capture.start();
      startEntered.resolve();
      return nativeStart.promise;
    },
  });
  await recorder.start(0, false, capture);
  assert.equal(counts.permission, 1);
  assert.equal(counts.starts, 0);
  permission.resolve(true);
  await startEntered.promise;
  await recorder.start(0, false, capture);
  assert.deepEqual(states.map((state) => state.phase), ['starting']);
  nativeStart.resolve();
  await start;
  assert.equal(counts.starts, 1);
  assert.equal(recorder.isRecording(), true);
  await recorder.cancel();
  assert.equal(counts.stops, 1);
});

test('leaving before permission resolves prevents a late start', async () => {
  const { recorder, states } = controls();
  const { capture, counts } = audio();
  const permission = deferred<boolean>();
  const start = recorder.start(2, true, { ...capture, requestPermission: () => permission.promise });
  await recorder.cancel();
  permission.resolve(true);
  await start;
  assert.equal(counts.starts, 0);
  assert.deepEqual(states.at(-1), { phase: 'idle' });
});

test('a late native start stops before either screen can start another attempt', async () => {
  const { recorder, states } = controls();
  const replacement = controls().recorder;
  const { capture, counts } = audio();
  const nativeStart = deferred<void>();
  const nativeStop = deferred<typeof file>();
  const startEntered = deferred<void>();
  const stopEntered = deferred<void>();
  const start = recorder.start(0, false, {
    ...capture,
    start() {
      startEntered.resolve();
      return nativeStart.promise;
    },
    stop() {
      stopEntered.resolve();
      return nativeStop.promise;
    },
  });
  await startEntered.promise;
  await recorder.cancel();
  nativeStart.resolve();
  await stopEntered.promise;
  await recorder.start(1, false, capture);
  await replacement.start(1, false, capture);
  assert.equal(counts.starts, 0);
  assert.deepEqual(states.map((state) => state.phase), ['starting', 'stopping']);
  nativeStop.resolve(file);
  await start;
  await replacement.start(1, false, capture);
  assert.equal(counts.starts, 1);
  await replacement.cancel();
});

test('overlapping submit actions stop and process once, including trailing PCM', async () => {
  const { recorder, states } = controls();
  const { capture, counts } = audio();
  const nativeStop = deferred<typeof file>();
  const transcript = deferred<void>();
  await recorder.start(3, true, {
    ...capture,
    async stop() {
      await capture.stop();
      return nativeStop.promise;
    },
  });
  let submissions = 0;
  const submitted = deferred<void>();
  const submit = recorder.submit(async ({ index, isRetry, recording, isCurrent }) => {
    submissions++;
    assert.equal(index, 3);
    assert.equal(isRetry, true);
    assert.equal(recording, file);
    assert.equal(isCurrent(), true);
    submitted.resolve();
    await transcript.promise;
  });
  await recorder.submit(async () => { submissions++; });
  nativeStop.resolve(file);
  await submitted.promise;
  recorder.feedAudio(new Uint8Array([1, 2]));
  assert.equal(counts.fed, 1);
  assert.equal(counts.aborts, 0);
  transcript.resolve();
  await submit;
  assert.equal(counts.stops, 1);
  assert.equal(submissions, 1);
  assert.deepEqual(states.at(-1), { phase: 'idle' });
});

test('exiting during transcription invalidates only that retry', async () => {
  const { recorder, states } = controls();
  const { capture } = audio();
  const transcript = deferred<void>();
  const submitted = deferred<void>();
  await recorder.start(1, true, capture);
  const submit = recorder.submit(async ({ isCurrent }) => {
    submitted.resolve();
    await transcript.promise;
    assert.equal(isCurrent(), false);
  });
  await submitted.promise;
  await recorder.cancel();
  const newer = audio();
  await recorder.start(1, true, newer.capture);
  transcript.resolve();
  await submit;
  assert.deepEqual(states.at(-1), { phase: 'recording', index: 1, isRetry: true });
  assert.equal(newer.counts.aborts, 0);
  await recorder.cancel();
});

test('a denied, failed or discarded retry leaves the recorder usable', async () => {
  const { recorder, states } = controls();
  const { capture } = audio();
  assert.equal(await recorder.start(1, true, { ...capture, requestPermission: async () => false }), 'denied');
  assert.deepEqual(states.at(-1), { phase: 'idle' });
  await assert.rejects(recorder.start(1, true, {
    ...capture,
    start: async () => { throw new Error('native start failed'); },
  }), /native start failed/);
  assert.deepEqual(states.at(-1), { phase: 'idle' });
  await recorder.start(1, true, {
    ...capture,
    stop: async () => { throw new Error('native stop failed'); },
  });
  await assert.rejects(recorder.submit(async () => assert.fail('no recording to score')), /native stop failed/);
  assert.deepEqual(states.at(-1), { phase: 'idle' });
  await recorder.start(1, true, capture);
  await assert.rejects(recorder.submit(async () => { throw new Error('transcription failed'); }), /transcription failed/);
  assert.deepEqual(states.at(-1), { phase: 'idle' });
  await recorder.start(1, true, capture);
  await recorder.cancel();
  assert.deepEqual(states.at(-1), { phase: 'idle' });
});
