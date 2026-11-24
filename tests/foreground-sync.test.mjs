import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real return tracker and foreground sync on iOS, against stubbed native modules and HTTP.
test('a quick return registers a permission just granted in iOS Settings, without the heartbeat', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-foreground-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const native = {
    'react-native': file('platform.cjs', 'exports.Platform = { OS: "ios" }; exports.Alert = { alert() {} }; exports.Linking = {}; globalThis.requestIdleCallback = () => 0;'),
    '@react-native-async-storage/async-storage': file('storage.cjs', `
      const values = new Map();
      module.exports = {
        async getItem(key) { return values.get(key) ?? null; },
        async setItem(key, value) { values.set(key, value); },
        async removeItem(key) { values.delete(key); },
      };`),
    'expo-notifications': file('notifications.cjs', `
      exports.IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 };
      exports.getPermissionsAsync = async () => ({ ios: { status: globalThis.iosPermission } });
      exports.getExpoPushTokenAsync = async () => ({ data: 'ExponentPushToken[test]' });`),
    'expo-constants': file('constants.cjs', 'exports.__esModule = true; exports.default = { expoConfig: { extra: { eas: { projectId: "test" } } } };'),
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return Object.hasOwn(native, specifier)
        ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });

  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'A' })).toString('base64url') + '.AA';
  const writes = [];
  let offline = false;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/token') {
      return Response.json({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user: { id: 'A' } });
    }
    if ((init.method ?? 'GET') !== 'GET') writes.push(url.pathname);
    if (offline) throw new TypeError('Network request failed');
    return url.pathname.startsWith('/rest/v1/rpc/') ? Response.json(null) : new Response(null, { status: 204 });
  });

  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  const { syncForegroundState } = await import('../lib/notifications/foreground.ts');
  const { usePrefsStore } = await import('../lib/notifications/preferences.ts');
  const { returnTracker } = await import('../lib/resume.ts');
  const { supabase } = await import('../lib/api/client.ts');
  t.after(() => supabase.auth.stopAutoRefresh());
  assert.ifError((await supabase.auth.signInWithPassword({ email: 'a@example.test', password: 'test' })).error);
  usePrefsStore.setState({ prefs: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } });

  let clock = 0;
  let sync = Promise.resolve();
  const track = returnTracker((resumed) => { sync = syncForegroundState({ resumed }); }, () => clock);
  const quickReturn = async () => {
    track('background');
    clock += 5_000;
    track('active');
    await sync;
  };

  globalThis.iosPermission = 1; // denied
  await syncForegroundState(); // sign-in sync
  writes.length = 0;

  await quickReturn();
  assert.deepEqual(writes, [], 'nothing changed: a quick return writes nothing');

  globalThis.iosPermission = 2; // turned on in iOS Settings
  await quickReturn();
  assert.deepEqual(writes, ['/rest/v1/rpc/register_device_token']);

  // A registration that failed (offline) is tried again on the next quick return, not only on a resume.
  globalThis.iosPermission = 1;
  await syncForegroundState();
  globalThis.iosPermission = 2;
  offline = true;
  await quickReturn();
  offline = false;
  writes.length = 0;
  await quickReturn();
  assert.deepEqual(writes, ['/rest/v1/rpc/register_device_token']);
});
