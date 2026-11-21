// lib-ok: Permanent licensing test for the grading report payload (R3 of the feedback feature).
import assert from 'node:assert/strict';
import test from 'node:test';
import { alignTranscription } from '@/lib/align';
import { calculateChunkScore } from '@/lib/study-chunks';
import { buildGradingReport } from './grading-report';

// KJV Romans 6:23, recited with a slip and stopped early.
const expected = 'For the wages of sin is death';
const transcript = 'for the payment of sin';
const alignment = alignTranscription(expected, transcript);
const unsaid = ['wages', 'is', 'death'];

function report(version: 'KJV' | 'ESV') {
  return buildGradingReport({
    verse: { book: 'Romans', chapter: 6, verseStart: 23, verseEnd: 23, version },
    chunk: { verseNum: 23 },
    difficulty: 'hard',
    chunkSize: 1,
    result: {
      score: calculateChunkScore(alignment),
      transcription: transcript,
      alignment,
      recording: { path: 'upload', liveFailure: 'never opened', model: 'stt-async-v5', durationMs: 3200 },
    },
    shown: 'scored',
  });
}

test('a licensed translation keeps positions and results, never the verse words', () => {
  const payload = report('ESV');
  for (const entry of payload.words) {
    if (entry.status !== 'added') assert.deepEqual(Object.keys(entry).sort(), ['i', 'status']);
  }
  assert.deepEqual(payload.words.filter((w) => w.status === 'added').map((w) => w.word), ['payment']);
  const json = JSON.stringify(payload).toLowerCase();
  for (const word of unsaid) assert.ok(!new RegExp(`\\b${word}\\b`).test(json), `"${word}" must not be stored`);
  assert.equal(payload.transcript, transcript);
});

test('KJV keeps the verse words', () => {
  const payload = report('KJV');
  const words = payload.words.filter((w) => w.status !== 'added').map((w) => w.word?.toLowerCase());
  for (const word of unsaid) assert.ok(words.includes(word));
  assert.deepEqual(payload.words.map((w) => w.i), [0, 1, 2, undefined, 3, 4, 5, 6]);
});

test('the payload carries the reference, chunk and how the recording was transcribed', () => {
  const payload = report('ESV');
  assert.deepEqual(payload.reference, { book: 'Romans', chapter: 6, verseStart: 23, verseEnd: 23 });
  assert.deepEqual(payload.chunkVerses, { start: 23, end: 23 });
  assert.equal(payload.translation, 'ESV');
  assert.equal(payload.shown, 'scored');
  assert.deepEqual(payload.recording, { path: 'upload', liveFailure: 'never opened', model: 'stt-async-v5', durationMs: 3200 });
});
