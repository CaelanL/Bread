import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const password = process.env.BREAD_LOCAL_TEST_PASSWORD;
const cwdUrl = readFileSync('.env.local', 'utf8').match(/^EXPO_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/m)?.[1];
assert.ok(url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Use the isolated local verifier.');
assert.equal(url, cwdUrl, 'Environment and verifier cwd must match.');
assert.ok(password, 'Supply the local seed password.');
const fixture = mkdtempSync(join(tmpdir(), 'bread-reference-check-'));
writeFileSync(join(fixture, 'platform.cjs'), 'exports.Platform={OS:"ios"};');
writeFileSync(join(fixture, 'storage.cjs'), 'const values=new Map();module.exports={async getItem(k){return values.get(k)??null},async setItem(k,v){values.set(k,v)},async removeItem(k){values.delete(k)}};');
const native: Record<string, string> = { 'react-native': join(fixture, 'platform.cjs'), '@react-native-async-storage/async-storage': join(fixture, 'storage.cjs') };
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return Object.hasOwn(native, specifier) ? { url: pathToFileURL(native[specifier]).href, shortCircuit: true } : nextResolve(specifier, context);
} });

async function main() {
  const { supabase } = await import('../lib/api/client');
  const { fetchVerse, clearSessionCache } = await import('../lib/api/bible');
  const { CURATED_COLLECTIONS } = await import('../lib/collections/catalog');
  const { collectionPassageReference } = await import('../lib/collections/passages');
  const { MONTHLY_PASSAGES } = await import('../lib/votm/schedule');
  const { BIBLE_VERSIONS } = await import('../lib/settings');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: 'reader-a@example.test', password: password! });
    assert.ifError(error);
    const passages = [...new Map([...CURATED_COLLECTIONS.flatMap(({ passages }) => passages), ...MONTHLY_PASSAGES]
      .map((passage) => [collectionPassageReference(passage), passage])).entries()];
    for (const { value: version } of BIBLE_VERSIONS) {
      clearSessionCache();
      const results: { version: string; reference: string; status: string; missingVerses?: number[] }[] = [];
      try { await fetchVerse(passages[0][0], version); }
      catch {
        for (const [reference] of passages) console.log(JSON.stringify({ version, reference, status: 'unverified' }));
        console.log(JSON.stringify({ version, checked: 1, passed: 0, unverified: passages.length, reason: 'Initial provider request failed; remaining reads skipped.' }));
        continue;
      }
      for (let offset = 0; offset < passages.length; offset += 2) {
        await Promise.all(passages.slice(offset, offset + 2).map(async ([reference, passage]) => {
          try {
            const result = await fetchVerse(reference, version);
            const missingVerses = Array.from({ length: passage.verseEnd - passage.verseStart + 1 }, (_, i) => passage.verseStart + i)
              .filter((verse) => !result.verses?.[verse]?.trim());
            results.push({ version, reference, status: result.version === version && !missingVerses.length ? 'pass' : 'unavailable',
              ...(missingVerses.length ? { missingVerses } : {}) });
          } catch { results.push({ version, reference, status: 'unverified' }); }
        }));
      }
      results.sort((a, b) => a.reference.localeCompare(b.reference));
      for (const result of results) console.log(JSON.stringify(result));
      console.log(JSON.stringify({ version, checked: results.length, passed: results.filter(({ status }) => status === 'pass').length }));
    }
  } finally { supabase.auth.stopAutoRefresh(); }
}
main().finally(() => { hooks.deregister(); rmSync(fixture, { recursive: true, force: true }); }).catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Reference verification failed.'); process.exitCode = 1;
});
