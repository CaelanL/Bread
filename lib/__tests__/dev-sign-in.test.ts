// lib-ok: test for lib/auth/dev-sign-in.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canDevSignIn } from '../auth/dev-sign-in';

describe('canDevSignIn', () => {
  it('allows a dev build on a local Supabase', () => {
    assert.equal(canDevSignIn(true, 'http://127.0.0.1:25541'), true);
    assert.equal(canDevSignIn(true, 'http://localhost:25541'), true);
  });

  it('refuses a production build, even on a local Supabase', () => {
    assert.equal(canDevSignIn(false, 'http://127.0.0.1:25541'), false);
  });

  it('refuses a dev build on any other Supabase', () => {
    assert.equal(canDevSignIn(true, 'https://abc.supabase' + '.co'), false);
    assert.equal(canDevSignIn(true, 'http://localhost.example.com:25541'), false);
    assert.equal(canDevSignIn(true, 'http://192.168.1.5:25541'), false);
    assert.equal(canDevSignIn(true, undefined), false);
  });
});
