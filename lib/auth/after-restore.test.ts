// lib-ok: unit tests for the launch restore outcomes and the stored session key.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthApiError, AuthRetryableFetchError, createClient } from '@supabase/supabase-js';

import { afterRestore, authStorageKey } from './after-restore';

const session = { user: { id: 'A' } };

test('a restored session continues', () => {
  assert.equal(afterRestore('A', { session, error: null }), 'continue');
  assert.equal(afterRestore(null, { session, error: null }), 'continue');
});

test('a refresh that could not reach the server stays on the saved library', () => {
  assert.equal(afterRestore('A', { session: null, error: new AuthRetryableFetchError('Failed to fetch', 0) }), 'offline');
});

test('a refused refresh, or nothing stored, is signed out', () => {
  assert.equal(afterRestore('A', { session: null, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') }), 'signed-out');
  assert.equal(afterRestore('A', { session: null, error: null }), 'signed-out');
  assert.equal(afterRestore(null, { session: null, error: new AuthRetryableFetchError('Failed to fetch', 0) }), 'signed-out');
});

test('the stored session key is the one supabase-js uses on local and prod URLs (a mismatch signs everyone out)', () => {
  for (const url of ['http://127.0.0.1:26644', 'https://abcdefghijklmnop.supabase.co']) {
    const client = createClient(url, 'key', { auth: { persistSession: false, autoRefreshToken: false } });
    const own = (client.auth as unknown as { storageKey: string }).storageKey;
    assert.equal(authStorageKey(url), own);
  }
});
