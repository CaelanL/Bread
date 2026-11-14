// lib-ok: Regression coverage for recorder ownership at the native boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFinalScore } from '@/lib/study-chunks';
import { getChunkReview, saveChunkResult, scoredAlignments, type ChunkResults } from './chunk-results';
import type { LiveTranscriptionSession } from './live-session';
import { createRecordingControls, removeAbandonedRecordings, type RecordingState } from './recording-controls';
import { scoreRecording } from './score-recording';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const file = { fileUri: 'file:///recitation.m4a', durationMs: 1200 };

function audio() {
  const counts = { permission: 0, starts: 0, stops: 0, fed: 0, aborts: 0, removed: [] as string[] };
  const live: LiveTranscriptionSession = {
    state: 'connecting',
    feedAudio: () => { counts.fed++; },
    finish: async () => 'be still',
    abort: () => { counts.aborts++; },
  };
  return {
    counts,
    capture: {
      hasPermission: () => false,
      requestPermission: async () => { counts.permission++; return true; },
      start: async () => { counts.starts++; },
      stop: async () => { counts.stops++; return file; },
      openLive: () => live,
      remove: async (uri: string) => { counts.removed.push(uri); },
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

test('with permission already granted, native start runs before the first state change', async () => {
  const order: string[] = [];
  const recorder = createRecordingControls((state) => order.push(state.phase));
  const { capture, counts } = audio();
  await recorder.start(0, false, {
    ...capture,
    hasPermission: () => true,
    async start() {
      order.push('native start');
      await capture.start();
    },
    openLive() {
      order.push('live');
      return capture.openLive();
    },
  });
  assert.deepEqual(order, ['native start', 'live', 'starting', 'recording']);
  assert.equal(counts.permission, 0);
  await recorder.cancel();
});

test('without permission, the prompt runs before native start', async () => {
  const order: string[] = [];
  const recorder = createRecordingControls((state) => order.push(state.phase));
  const { capture } = audio();
  await recorder.start(0, false, {
    ...capture,
    async requestPermission() {
      order.push('prompt');
      return true;
    },
    async start() {
      order.push('native start');
    },
  });
  assert.deepEqual(order, ['starting', 'prompt', 'native start', 'recording']);
  await recorder.cancel();
});

test('a take discarded during a granted-permission start is stopped and removed once start resolves', async () => {
  const { recorder, states } = controls();
  const { capture, counts } = audio();
  const nativeStart = deferred<void>();
  const start = recorder.start(0, false, {
    ...capture,
    hasPermission: () => true,
    start: () => nativeStart.promise,
  });
  await recorder.cancel();
  assert.equal(counts.stops, 0);
  nativeStart.resolve();
  await start;
  assert.equal(counts.stops, 1);
  assert.deepEqual(counts.removed, [file.fileUri]);
  assert.deepEqual(states.map((state) => state.phase), ['starting', 'stopping', 'idle']);
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

test('an interrupted retry restores the prior result and controls without changing the original score', async () => {
  let results: ChunkResults = new Map();
  let recording: RecordingState = { phase: 'idle' };
  let page = 0;
  const recorder = createRecordingControls((state) => { recording = state; });
  const review = () => getChunkReview(results, 0, page, 2, recording);
  const { capture } = audio();
  const withTranscript = (finish: LiveTranscriptionSession['finish']) => ({
    ...capture,
    openLive: () => ({ ...capture.openLive(), finish }),
  });
  const submit = () => recorder.submit(async ({ index, isRetry, liveSession, isCurrent }) => {
    const result = await scoreRecording({
      text: 'be still',
      isRetry,
      isPeeked: false,
      liveSession,
      isCurrent,
      async transcribeFile() { throw new Error('upload failed'); },
    });
    if (result && isCurrent()) results = saveChunkResult(results, index, result, false);
  });

  await recorder.start(0, false, withTranscript(async () => 'be'));
  await submit();
  const original = review().display;
  assert.equal(original?.score, 50);
  assert.equal(calculateFinalScore(scoredAlignments(results)), 50);
  assert.equal(review().canRetry, true);

  await recorder.start(0, true, capture);
  await submit();
  const priorRetry = review().display;
  assert.equal(priorRetry?.score, 100);

  function assertRestored() {
    const restored = review();
    assert.deepEqual(restored.originalDisplay, original);
    assert.deepEqual(restored.display, priorRetry);
    assert.equal(restored.isRetryResult, true);
    assert.equal(restored.canContinue, true);
    assert.equal(restored.canRetry, true);
    assert.equal(calculateFinalScore(scoredAlignments(results)), 50);
  }
  assertRestored();

  await recorder.start(0, true, capture);
  assert.equal(review().display, undefined);
  assert.equal(review().canRetry, false);
  assert.equal(review().canContinue, false);
  await recorder.cancel();
  assertRestored();

  assert.equal(await recorder.start(0, true, { ...capture, requestPermission: async () => false }), 'denied');
  assertRestored();
  await assert.rejects(recorder.start(0, true, {
    ...capture,
    start: async () => { throw new Error('native start failed'); },
  }), /native start failed/);
  assertRestored();
  await recorder.start(0, true, {
    ...capture,
    stop: async () => { throw new Error('native stop failed'); },
  });
  await assert.rejects(submit(), /native stop failed/);
  assertRestored();
  await recorder.start(0, true, withTranscript(async () => { throw new Error('socket closed'); }));
  await assert.rejects(submit(), /upload failed/);
  assertRestored();

  const entered = deferred<void>();
  const late = deferred<string>();
  await recorder.start(0, true, withTranscript(() => {
    entered.resolve();
    return late.promise;
  }));
  const submitting = submit();
  await entered.promise;
  page = 1;
  await recorder.cancel();
  assert.equal(review().canContinue, false);
  page = 0;
  assertRestored();
  late.resolve('still');
  await submitting;
  assertRestored();
  assert.equal(getChunkReview(results, 0, 0, 1, recording).canRetry, false);
});

test('a submitted recording is removed once, only after processing settles', async () => {
  const { recorder } = controls();
  const { capture, counts } = audio();
  const same = { fileUri: 'file:///take.m4a', compression: { compressedFileUri: 'file:///take.m4a' } };
  await recorder.start(0, false, { ...capture, stop: async () => same });
  const processing = deferred<void>();
  const entered = deferred<void>();
  const submit = recorder.submit(async () => {
    entered.resolve();
    await processing.promise;
  });
  await entered.promise;
  assert.deepEqual(counts.removed, []);
  processing.resolve();
  await submit;
  assert.deepEqual(counts.removed, ['file:///take.m4a']);
});

test('a failed upload still removes both files, and a failed removal keeps the score', async () => {
  const { recorder } = controls();
  const { capture, counts } = audio();
  const both = { fileUri: 'file:///take.wav', compression: { compressedFileUri: 'file:///take.m4a' } };
  await recorder.start(0, false, { ...capture, stop: async () => both });
  await assert.rejects(recorder.submit(async () => { throw new Error('upload failed'); }), /upload failed/);
  assert.deepEqual(counts.removed.sort(), ['file:///take.m4a', 'file:///take.wav']);

  let scored = false;
  await recorder.start(0, false, { ...capture, remove: async () => { throw new Error('disk busy'); } });
  await recorder.submit(async () => { scored = true; });
  assert.equal(scored, true);
});

test('a discarded take is removed only after native capture stops', async () => {
  const { recorder } = controls();
  const { capture, counts } = audio();
  const nativeStop = deferred<typeof file>();
  await recorder.start(0, false, { ...capture, stop: () => nativeStop.promise });
  const cancel = recorder.cancel();
  await Promise.resolve();
  assert.deepEqual(counts.removed, []);
  nativeStop.resolve(file);
  await cancel;
  assert.deepEqual(counts.removed, [file.fileUri]);
});

test('a take discarded during native start is removed after its late stop', async () => {
  const { recorder } = controls();
  const { capture, counts } = audio();
  const nativeStart = deferred<void>();
  const startEntered = deferred<void>();
  const start = recorder.start(0, false, {
    ...capture,
    start() {
      startEntered.resolve();
      return nativeStart.promise;
    },
  });
  await startEntered.promise;
  await recorder.cancel();
  assert.deepEqual(counts.removed, []);
  nativeStart.resolve();
  await start;
  assert.deepEqual(counts.removed, [file.fileUri]);
});

test('cancelling during processing keeps the file until processing settles', async () => {
  const { recorder } = controls();
  const { capture, counts } = audio();
  const upload = deferred<void>();
  const entered = deferred<void>();
  await recorder.start(0, false, capture);
  const submit = recorder.submit(async () => {
    entered.resolve();
    await upload.promise;
  });
  await entered.promise;
  await recorder.cancel();
  assert.deepEqual(counts.removed, []);
  upload.resolve();
  await submit;
  assert.deepEqual(counts.removed, [file.fileUri]);
});

function folders(listing: Record<string, string[]>) {
  const deleted: string[] = [];
  return {
    deleted,
    fs: {
      documentDirectory: 'file:///Documents/',
      cacheDirectory: 'file:///Caches/',
      async readDirectoryAsync(dir: string) {
        if (!listing[dir]) throw new Error('no such directory');
        return listing[dir];
      },
      async deleteAsync(uri: string) { deleted.push(uri); },
    },
  };
}

const id = (n: number) => `${String(n).padStart(8, '0')}-AAAA-4BBB-8CCC-DDDDDDDDDDDD`;

test('abandoned recordings are removed only from the known names and places', async () => {
  const { fs, deleted } = folders({
    'file:///Documents/': [
      `${id(1)}.m4a`, `${id(2)}.M4A`, `${id(3)}.wav`, `${id(4)}.json`, `x${id(5)}.m4a`,
      `recording-${id(6)}.m4a`, 'notes.m4a', 'bread-recordings', `${id(7)}`,
    ],
    'file:///Caches/AV/': [`recording-${id(8)}.m4a`, `${id(9)}.m4a`, 'recording-1.m4a'],
  });
  await removeAbandonedRecordings(fs);
  assert.deepEqual(deleted, [
    `file:///Documents/${id(1)}.m4a`,
    `file:///Documents/${id(2)}.M4A`,
    `file:///Caches/AV/recording-${id(8)}.m4a`,
  ]);
});

test('abandoned-recording cleanup survives missing folders and failed deletes', async () => {
  const { fs } = folders({ 'file:///Caches/AV/': [`recording-${id(1)}.m4a`, `recording-${id(2)}.m4a`] });
  const tried: string[] = [];
  await removeAbandonedRecordings({
    ...fs,
    async deleteAsync(uri) {
      tried.push(uri);
      throw new Error('permission denied');
    },
  });
  assert.equal(tried.length, 2);
});

test('abandoned-recording cleanup never runs while an attempt may still need its file', async () => {
  const names = Array.from({ length: 45 }, (_, n) => `${id(n)}.m4a`);
  const { recorder } = controls();
  const { capture } = audio();

  await recorder.start(0, false, capture);
  const processing = deferred<void>();
  const entered = deferred<void>();
  const submit = recorder.submit(async () => {
    entered.resolve();
    await processing.promise;
  });
  await entered.promise;
  const busy = folders({ 'file:///Documents/': names });
  await removeAbandonedRecordings(busy.fs);
  assert.deepEqual(busy.deleted, []);
  processing.resolve();
  await submit;

  const batch = deferred<void>();
  const batchEntered = deferred<void>();
  const idle = folders({ 'file:///Documents/': names });
  const sweep = removeAbandonedRecordings({
    ...idle.fs,
    async deleteAsync(uri) {
      await idle.fs.deleteAsync(uri);
      batchEntered.resolve();
      await batch.promise;
    },
  });
  await batchEntered.promise;
  assert.equal(idle.deleted.length, 20);
  await recorder.start(0, false, capture);
  batch.resolve();
  await sweep;
  assert.equal(idle.deleted.length, 20);
  await recorder.cancel();
});
