// lib-ok: Tests for the intro scrub-bar math.
import assert from 'node:assert/strict';
import test from 'node:test';

import { playbackClock, playbackFraction, seekPosition } from './scrub';

test('playback fraction clamps to the track and treats an unknown duration as the start', () => {
  assert.equal(playbackFraction(4500, 9000), 0.5);
  assert.equal(playbackFraction(-200, 9000), 0);
  assert.equal(playbackFraction(9400, 9000), 1);
  assert.equal(playbackFraction(4500, 0), 0);
});

test('seek position clamps a drag past either end of the track to the clip', () => {
  assert.equal(seekPosition(0.5, 9000), 4500);
  assert.equal(seekPosition(-0.3, 9000), 0);
  assert.equal(seekPosition(1.7, 9000), 9000);
  assert.equal(seekPosition(1 / 3, 9000), 3000);
  assert.equal(seekPosition(Number.NaN, 9000), 0);
  assert.equal(seekPosition(0.5, 0), 0);
});

test('playback clock keeps the mm:ss format the player shows', () => {
  assert.equal(playbackClock(0), '00:00');
  assert.equal(playbackClock(3999), '00:03');
  assert.equal(playbackClock(75_000), '01:15');
  assert.equal(playbackClock(-50), '00:00');
});
