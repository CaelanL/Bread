// lib-ok: Unit tests for the shared collection caps.
import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_SHARED_COLLECTIONS, shareHitsCap } from './constants';

test('at the cap, Share… on a new or personal collection is refused', () => {
  assert.equal(shareHitsCap(undefined, MAX_SHARED_COLLECTIONS), true);
  assert.equal(shareHitsCap(undefined, MAX_SHARED_COLLECTIONS - 1), false);
});

test('at the cap, Share… on a collection that already has a group still opens it', () => {
  assert.equal(shareHitsCap('g-1', MAX_SHARED_COLLECTIONS), false);
});
