// lib-ok: tests for the resume and Home reload rules next to them
import assert from 'node:assert/strict';
import test from 'node:test';

import { homeStale, resumeTracker, returnTracker } from './resume';

function tracker() {
  let clock = 0;
  let calls = 0;
  const track = resumeTracker(() => calls++, () => clock);
  return { track, advance: (ms: number) => { clock += ms; }, calls: () => calls };
}

test('away under 30 s is not a resume', () => {
  const t = tracker();
  t.track('background');
  t.advance(10_000);
  t.track('active');
  assert.equal(t.calls(), 0);
});

test('away 31 s is one resume', () => {
  const t = tracker();
  t.track('background');
  t.advance(31_000);
  t.track('active');
  t.track('active');
  assert.equal(t.calls(), 1);
});

test('inactive counts as away, timed from when it started', () => {
  const t = tracker();
  t.track('inactive');
  t.advance(20_000);
  t.track('background');
  t.advance(11_000);
  t.track('active');
  assert.equal(t.calls(), 1);
});

test('Home reloads when its last load is old, another key or month, or a session was saved since', () => {
  const last = { key: 'a:ESV', at: 0, sessionAt: null, month: '2026-11' };
  assert.equal(homeStale(null, last), true);
  assert.equal(homeStale(last, { ...last, at: 60_000 }), false);
  assert.equal(homeStale(last, { ...last, at: 5 * 60_000 }), true);
  assert.equal(homeStale(last, { ...last, at: 1, sessionAt: 1 }), true);
  assert.equal(homeStale(last, { ...last, at: 1, key: 'a:NIV' }), true);
  assert.equal(homeStale(last, { ...last, at: 1, month: '2026-12' }), true);
});

test('every return is reported; only one away 30 s or more is a resume', () => {
  let clock = 0;
  const returns: boolean[] = [];
  const track = returnTracker((resumed) => returns.push(resumed), () => clock);
  track('inactive');
  clock += 5_000;
  track('active');
  track('active');
  track('background');
  clock += 31_000;
  track('active');
  assert.deepEqual(returns, [false, true]);
});
