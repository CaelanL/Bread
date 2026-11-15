import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real useStreak, rendered with a minimal hooks stub (state kept across renders, effects run
// when their deps change), its streak reads answered in whatever order the test chooses.
test('the streak shows only the latest read for the current account', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-streak-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const stubs = {
    react: file('react.cjs', `
      const slots = []; let index = 0;
      globalThis.render = (hook) => { index = 0; return hook(); };
      exports.useState = (initial) => {
        const i = index++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], (value) => { slots[i] = value; }];
      };
      exports.useRef = (current) => { const i = index++; if (!(i in slots)) slots[i] = { current }; return slots[i]; };
      exports.useCallback = (f) => { index++; return f; };
      exports.useEffect = (effect, deps) => {
        const i = index++;
        if (!(i in slots) || deps.some((d, k) => d !== slots[i][k])) { slots[i] = deps; effect(); }
      };`),
    '@/hooks/use-home-reload': file('home-reload.cjs', 'exports.useHomeReload = (key, reload) => { globalThis.reload = reload; };'),
    '@/lib/api': file('api.cjs', `
      globalThis.reads = [];
      exports.getCurrentStreak = () => { const read = Promise.withResolvers(); globalThis.reads.push(read); return read.promise; };`),
    '@/lib/auth': file('auth.cjs', 'exports.useAuth = () => ({ user: globalThis.user });'),
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return Object.hasOwn(stubs, specifier) && context.parentURL?.endsWith('/hooks/use-streak.ts')
        ? { url: pathToFileURL(stubs[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });
  const { useStreak } = await import('../hooks/use-streak.ts');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 1));

  globalThis.user = { id: 'A' };
  globalThis.render(useStreak);
  const older = globalThis.reload();
  const newer = globalThis.reload();
  globalThis.reads[1].resolve(5);
  assert.equal(await newer, true);
  globalThis.reads[0].resolve(3);
  assert.equal(await older, false);
  assert.equal(globalThis.render(useStreak).streak, 5, 'the older read, landing last, is dropped');

  const fromA = globalThis.reload();
  globalThis.user = { id: 'B' };
  globalThis.render(useStreak);
  globalThis.reads[2].resolve(9);
  assert.equal(await fromA, false);
  await settle();
  assert.equal(globalThis.render(useStreak).streak, 5, "A's late read never shows for B");
});
