// lib-ok: Exercises transcript fallback and scoring at the live and file boundaries.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveTranscriptionSession } from './live-session';
import { scoreRecording } from './score-recording';

const base = {
  text: 'be still',
  isRetry: false,
  isPeeked: false,
  isCurrent: () => true,
};

function live(finish: LiveTranscriptionSession['finish']): LiveTranscriptionSession {
  return { state: 'streaming', finish, feedAudio() {}, abort() {} };
}

const neverUpload = async () => assert.fail('live success should not upload');

test('a successful retry has a display result and no replacement score', async () => {
  const original = await scoreRecording({
    ...base,
    liveSession: live(async () => 'be'),
    transcribeFile: neverUpload,
  });
  const retry = await scoreRecording({
    ...base,
    isRetry: true,
    liveSession: live(async () => 'be still'),
    transcribeFile: neverUpload,
  });
  assert.equal(original?.scored?.score, 50);
  assert.equal(retry?.display.score, 100);
  assert.equal(retry?.scored, undefined);
});

test('live failure falls back to the file and a revealed chunk keeps its display alignment', async () => {
  const result = await scoreRecording({
    ...base,
    isPeeked: true,
    liveSession: live(async () => { throw new Error('socket closed'); }),
    transcribeFile: async () => 'be still',
  });
  assert.equal(result?.display.score, 100);
  assert.equal(result?.scored?.score, 0);
  assert.deepEqual(result?.scored?.alignment.map((word) => word.status), ['missing', 'missing']);
});

test('an interrupted retry produces no result after file transcription resolves', async () => {
  let current = true;
  const result = await scoreRecording({
    ...base,
    isRetry: true,
    isCurrent: () => current,
    liveSession: live(async () => { throw new Error('socket closed'); }),
    transcribeFile: async () => {
      current = false;
      return 'be still';
    },
  });
  assert.equal(result, undefined);
});

test('leaving during live finalize skips the fallback upload', async () => {
  let current = true;
  const result = await scoreRecording({
    ...base,
    isCurrent: () => current,
    liveSession: live(async () => {
      current = false;
      throw new Error('socket closed');
    }),
    transcribeFile: neverUpload,
  });
  assert.equal(result, undefined);
});
