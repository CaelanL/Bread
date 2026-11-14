import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real AuthProvider launch, run once with React's hooks stubbed (effects run at once, state
// setters record what was published), against the real store and auth client over stubbed HTTP.
test("a launch whose snapshot paint finishes after a sign-in as another account doesn't publish its session", async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-auth-launch-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const native = {
    'react-native': file('platform.cjs', 'exports.Platform = { OS: "android" }; exports.Alert = { alert() {} }; exports.Linking = {}; exports.InteractionManager = { runAfterInteractions() {} };'),
    // A key in globalThis.heldKeys answers only when its promise is resolved.
    '@react-native-async-storage/async-storage': file('storage.cjs', `
      const values = new Map(); globalThis.storedValues = values; globalThis.heldKeys = new Map();
      module.exports = {
        async getItem(key) {
          const held = globalThis.heldKeys.get(key);
          if (held) await held.promise;
          return values.get(key) ?? null;
        },
        async setItem(key, value) { values.set(key, value); },
        async removeItem(key) { values.delete(key); },
      };`),
    'expo-notifications': file('notifications.cjs', 'module.exports = {};'),
    'expo-constants': file('constants.cjs', 'module.exports = { default: {} };'),
    'expo-linking': file('linking.cjs', 'exports.parse = () => ({}); exports.getInitialURL = async () => null; exports.addEventListener = () => ({ remove() {} });'),
    'expo-router': file('router.cjs', 'exports.router = {};'),
  };
  const react = file('react.cjs', `
    globalThis.published = [];
    const names = ['user', 'session', 'isLoading', 'restoredUserId'];
    let calls = 0;
    exports.createContext = () => ({ Provider: 'Provider' });
    exports.useContext = () => undefined;
    exports.useEffect = (effect) => { globalThis.unmount = effect(); };
    exports.useState = (initial) => { const name = names[calls++ % 4]; return [initial, (value) => globalThis.published.push([name, value])]; };
    exports.createElement = () => null;
    exports.default = exports;`);
  const jsx = file('jsx.cjs', 'exports.jsx = () => null; exports.jsxs = () => null; exports.jsxDEV = () => null; exports.Fragment = "Fragment";');
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromProvider = context.parentURL?.endsWith('/lib/auth/context.tsx');
      if (fromProvider && specifier === 'react') return { url: pathToFileURL(react).href, shortCircuit: true };
      if (fromProvider && specifier.startsWith('react/jsx')) return { url: pathToFileURL(jsx).href, shortCircuit: true };
      return Object.hasOwn(native, specifier)
        ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });

  const tokens = Object.fromEntries(['A', 'B'].map((account) => [
    account, 'e30.' + Buffer.from(JSON.stringify({ sub: account, exp: 4102444800 })).toString('base64url') + '.AA',
  ]));
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/token') {
      const id = JSON.parse(init.body).email[0];
      return Response.json({ access_token: tokens[id], refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id } });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
    if ((init.method ?? 'GET') !== 'GET') return new Response(null, { status: 204 });
    return Response.json([]);
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { supabase } = await import('../lib/api/client.ts');
  const { serializeSnapshot } = await import('../lib/store/snapshot.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  const until = async (done) => {
    for (let i = 0; i < 1000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.ok(done(), 'timed out');
  };

  // A is signed in from the last run, with a saved library whose read is slow.
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'A@example.test', password: 'test' })).error);
  globalThis.storedValues.set('library_snapshot:A', serializeSnapshot({
    collections: [{ id: 'my-verses', name: 'My Verses', isDefault: true, createdAt: 0 }],
    verses: [], masteredVerses: [], sharedCollections: {}, displayName: null, firstName: null, lastName: null,
  }, Date.now()));
  const snapshotRead = Promise.withResolvers();
  globalThis.heldKeys.set('library_snapshot:A', snapshotRead);

  const { AuthProvider } = await import('../lib/auth/context.tsx');
  AuthProvider({ children: null });
  t.after(() => globalThis.unmount?.());
  await new Promise((resolve) => setTimeout(resolve, 20));

  // An OAuth sign-in as B finishes while A's launch waits on its paint.
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'B@example.test', password: 'test' })).error);
  await until(() => globalThis.published.some(([name, value]) => name === 'session' && value?.user.id === 'B'));
  globalThis.heldKeys.delete('library_snapshot:A');
  snapshotRead.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessions = globalThis.published.filter(([name]) => name === 'session').map(([, value]) => value?.user.id ?? null);
  assert.equal(sessions.at(-1), 'B');
  assert.equal(globalThis.published.some(([name, value]) => name === 'restoredUserId' && value === 'A'), false);
});
