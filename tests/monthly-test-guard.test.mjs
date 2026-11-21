import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('monthly migration verification rejects a different cwd before launching the database CLI', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bread-monthly-cwd-guard-'));
  const marker = join(fixture, 'cli-was-called');
  const cliDirectory = join(fixture, 'node_modules', '.bin');
  mkdirSync(cliDirectory, { recursive: true });
  writeFileSync(join(fixture, '.env.local'), 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:1111\n');
  writeFileSync(join(cliDirectory, 'supabase'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called'); process.exit(99);\n`, { mode: 0o755 });
  const loader = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));
  const target = fileURLToPath(new URL('./monthly-schedule-migration.integration.ts', import.meta.url));
  const run = (url) => {
    const environment = { ...process.env, EXPO_PUBLIC_SUPABASE_URL: url };
    delete environment.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--import', loader, '--test', target], {
      cwd: fixture, encoding: 'utf8', env: environment,
    });
  };
  try {
    const mismatched = run('http://127.0.0.1:2222');
    assert.notEqual(mismatched.status, 0, mismatched.stdout + mismatched.stderr);
    assert.match(mismatched.stdout + mismatched.stderr, /same disposable worktree/);
    assert.equal(existsSync(marker), false, 'A mismatched worktree must never reach the CLI.');
    const matched = run('http://127.0.0.1:1111');
    assert.notEqual(matched.status, 0, 'The safe fake CLI intentionally returns99.');
    assert.equal(existsSync(marker), true, 'A matched worktree reaches only the fake CLI, never a database.');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
