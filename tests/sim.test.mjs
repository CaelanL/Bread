// `npm run sim` in a scratch folder with a stand-in xcrun, so no real simulator or lock is touched.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function simShot(xcrunError) {
  const dir = mkdtempSync(join(tmpdir(), 'sim-'))
  try {
    mkdirSync(join(dir, 'bin'))
    cpSync(new URL('../scripts/sim.mjs', import.meta.url), join(dir, 'scripts/sim.mjs'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', kit: { sim: { name: 'scratch', scheme: 'scratch' } } }))
    writeFileSync(join(dir, 'bin/xcrun'), `#!/bin/sh\necho '${xcrunError}' >&2\nexit 1\n`)
    chmodSync(join(dir, 'bin/xcrun'), 0o755)
    const env = { ...process.env, HOME: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }
    const r = spawnSync(process.execPath, ['scripts/sim.mjs', 'shot', '/'], { cwd: dir, env, encoding: 'utf8' })
    return { status: r.status, out: r.stdout + r.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("a simulator blocked by Codex's sandbox says to run the plain command", () => {
  const r = simShot('simctl[1:2] CoreSimulatorService connection became invalid.  Simulator services will no longer be available.')
  assert.equal(r.status, 1)
  assert.match(r.out, /sandbox blocks the simulator\. Run `npm run sim …` as a plain command/)
})

test('any other simctl failure keeps its own error text', () => {
  const r = simShot('Unable to boot device')
  assert.equal(r.status, 1)
  assert.match(r.out, /xcrun simctl list devices booted -j failed: Unable to boot device/)
  assert.doesNotMatch(r.out, /sandbox/)
})
