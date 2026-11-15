import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The real useVersePreview, rendered with a minimal hooks stub (state kept across renders, effects
// run when their deps change), its verse reads answered in whatever order the test chooses.
test("a verse card's preview: no loader flash, and a failed read retried on pull to refresh", async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-verse-preview-'));
  const file = (name, body) => { writeFileSync(join(fixture, name), body); return join(fixture, name); };
  const stubs = {
    react: file('react.cjs', `
      const slots = []; let index = 0;
      globalThis.render = (hook) => { index = 0; return hook(); };
      exports.useState = (initial) => {
        const i = index++;
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], (value) => { slots[i] = value; }];
      };
      exports.useRef = (current) => { const i = index++; if (!(i in slots)) slots[i] = { current }; return slots[i]; };
      exports.useEffect = (effect, deps) => {
        const i = index++;
        if (!(i in slots) || deps.some((d, k) => d !== slots[i][k])) { slots[i] = deps; effect(); }
      };`),
    '@/lib/api/bible': file('bible.cjs', `
      globalThis.reads = [];
      exports.peekVerseText = () => null;
      exports.getVerseText = () => { const read = Promise.withResolvers(); globalThis.reads.push(read); return read.promise; };`),
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return Object.hasOwn(stubs, specifier) && context.parentURL?.endsWith('/hooks/use-verse-preview.ts')
        ? { url: pathToFileURL(stubs[specifier]).href, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); });
  const { useVersePreview } = await import('../hooks/use-verse-preview.ts');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 1));
  const verse = () => ({ id: 'v1', version: 'ESV', book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 });
  const render = (v) => globalThis.render(() => useVersePreview(v, false));

  let shown = verse();
  assert.deepEqual(render(shown), { text: '', loading: true });
  globalThis.reads[0].reject(new Error('offline'));
  await settle();
  assert.deepEqual(render(shown), { text: 'Failed to load verse text', loading: false });

  // Pull to refresh replaces the verse object: the failed read is tried again, with no loader.
  shown = verse();
  assert.deepEqual(render(shown), { text: 'Failed to load verse text', loading: false });
  assert.equal(globalThis.reads.length, 2, 'the failed read is retried');
  globalThis.reads[1].resolve({ text: 'For God so loved the world' });
  await settle();
  assert.deepEqual(render(shown), { text: 'For God so loved the world', loading: false });

  // A study prefs save swaps the object again: nothing is read, nothing flashes.
  shown = verse();
  assert.deepEqual(render(shown), { text: 'For God so loved the world', loading: false });
  assert.equal(globalThis.reads.length, 2);
});
