#!/usr/bin/env node
// See the app's screens without Xcode. Expo apps only. Needs "sim" in package.json "kit":
//   "sim": { "name": "<short app name>", "scheme": "<URL scheme>" }
//
//   npm run sim -- shot <route> [<route>...] [--keep]   screenshots to .expo/sim-shots/
//   npm run sim -- stop                                 stops Metro and the device
//   npm run sim -- install                              installs the latest simulator build
//
// The app must add a <scheme>://dev-sign-in?next=<route> route. Still unproven:
//   4. `npx eas-cli build:run -p ios --profile simulator --latest`: flags are right per --help; that it installs on DEVICE is not run.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const MAX_SIMS = 1;
const DEVICE = 'iPhone 16 Pro';
const SETTLE_MS = 5000;
const METRO_TIMEOUT_MS = 120_000;
const BUNDLE_TIMEOUT_MS = 300_000;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
if (!kit.sim?.name || !kit.sim?.scheme) die('package.json needs kit.sim: { "name": ..., "scheme": ... }.');
const CACHE = join(homedir(), '.cache');
const LOCK = join(CACHE, `${kit.sim.name}-sim.lock`);
const FINGERPRINT = join(CACHE, `${kit.sim.name}-sim.json`);
const LOG = join(root, '.expo/sim-metro.log');
const SHOTS = join(root, '.expo/sim-shots');

function die(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

function must(cmd, args) {
  const r = run(cmd, args);
  if (!r.ok) die(`${cmd} ${args.join(' ')} failed: ${r.err.trim()}`);
  return r.out;
}

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

// ---------- lock: one simulator at a time, across all worktrees

function bootedDevices() {
  const parsed = JSON.parse(must('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']));
  return Object.values(parsed.devices).flat().map((d) => d.name);
}

function takeLock() {
  mkdirSync(CACHE, { recursive: true });
  const held = readJson(LOCK);
  if (held && held.folder !== root && isAlive(held.pid)) die(`simulator busy: ${held.folder} since ${held.since}`);
  if (!held || held.folder !== root) {
    const others = bootedDevices().filter((name) => name !== DEVICE);
    if (others.length >= MAX_SIMS) die(`simulator busy: ${others.join(', ')} is booted (limit ${MAX_SIMS}). Shut it down first.`);
  }
  writeFileSync(LOCK, JSON.stringify({ folder: root, pid: process.pid, since: new Date().toISOString() }));
  if (held?.folder === root) stopMetro(held); // a --keep run left one behind
}

// ---------- native fingerprint

function currentFingerprint() {
  // 4608 = the default skips (512) + the config's extra section (4096). app.config.js puts this folder's
  // Supabase URL in extra, so without it the hash changes per worktree with no native change.
  const out = must('npx', ['@expo/fingerprint', 'fingerprint:generate', '--source-skips', '4608']);
  const hash = JSON.parse(out).hash;
  if (!hash) die('Could not read the native fingerprint.');
  return hash;
}

// The first run records today's fingerprint: the installed build matches it (nothing native changed since).
function checkFingerprint() {
  const now = currentFingerprint();
  const saved = readJson(FINGERPRINT)?.fingerprint;
  if (!saved) {
    writeFileSync(FINGERPRINT, JSON.stringify({ fingerprint: now }));
    return;
  }
  if (saved !== now) {
    die('Native code changed since the simulator build. Run `npx eas-cli build -p ios --profile simulator` (uses 1 of 15 free builds a month), then `npm run sim -- install`.');
  }
}

// ---------- device and Metro

function bootDevice() {
  run('xcrun', ['simctl', 'boot', DEVICE]); // fails harmlessly when already booted
  must('xcrun', ['simctl', 'bootstatus', DEVICE, '-b']);
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

async function startMetro() {
  const port = await freePort();
  mkdirSync(dirname(LOG), { recursive: true });
  const log = openSync(LOG, 'w');
  const metro = spawn('npx', ['expo', 'start', '--dev-client', '--port', String(port)], {
    cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, CI: '1' },
  });
  closeSync(log);
  metro.unref();
  writeFileSync(LOCK, JSON.stringify({ ...readJson(LOCK), pid: metro.pid })); // the lock lives as long as Metro
  const deadline = Date.now() + METRO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await (await fetch(`http://127.0.0.1:${port}/status`)).text()).includes('running')) return port;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  stopAll();
  return die(`Metro didn't start. See ${LOG}`);
}

// A screenshot taken before this shows the "Bundling 53%" banner, not the app.
async function waitForBundle() {
  const deadline = Date.now() + BUNDLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (/Bundled \d+ms/.test(readFileSync(LOG, 'utf8'))) return;
    await sleep(1000);
  }
  stopAll();
  die(`The app didn't finish bundling. See ${LOG}`);
}

const openUrl = (url) => must('xcrun', ['simctl', 'openurl', 'booted', url]);
const fileName = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'home';

function stopMetro(held) {
  if (!held?.pid || held.pid === process.pid) return;
  try { process.kill(-held.pid, 'SIGTERM'); } catch { /* already gone */ }
}

function stopAll() {
  stopMetro(readJson(LOCK));
  run('xcrun', ['simctl', 'shutdown', DEVICE]);
  rmSync(LOCK, { force: true });
}

// ---------- commands

async function shot(args) {
  const keep = args.includes('--keep');
  const routes = args.filter((a) => a !== '--keep');
  if (!routes.length && !keep) die('Usage: npm run sim -- shot <route> [<route>...] [--keep]');
  takeLock();
  checkFingerprint(); // before booting: a rebuild message boots nothing
  // Starts the stack if needed and rewrites the env file, then refuses a non-local database.
  must(process.execPath, ['scripts/db.mjs', 'start']);
  must(process.execPath, ['scripts/db.mjs', 'guard']);
  bootDevice();
  const port = await startMetro();
  openUrl(`${kit.sim.scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}?disableOnboarding=1`)}`);
  await waitForBundle();
  await sleep(SETTLE_MS);
  mkdirSync(SHOTS, { recursive: true });
  for (const route of routes) {
    openUrl(`${kit.sim.scheme}://dev-sign-in?next=${encodeURIComponent(route)}`); 
    await sleep(SETTLE_MS);
    const file = join(SHOTS, `${fileName(route)}.png`);
    must('xcrun', ['simctl', 'io', 'booted', 'screenshot', file]);
    console.log(file);
  }
  if (!keep) stopAll();
}

function stopCommand() {
  const held = readJson(LOCK);
  if (held && held.folder !== root && isAlive(held.pid)) die(`simulator busy: ${held.folder} since ${held.since}. Run stop there.`);
  stopAll();
  console.log('Simulator and Metro stopped.');
}

function install() {
  takeLock();
  bootDevice();
  const r = run('npx', ['eas-cli', 'build:run', '-p', 'ios', '--profile', 'simulator', '--latest'], { stdio: 'inherit' }); // unproven (4)
  if (!r.ok) die('Install failed. See the output above.');
  writeFileSync(FINGERPRINT, JSON.stringify({ fingerprint: currentFingerprint() }));
  console.log('Simulator build installed.');
}

const [command, ...args] = process.argv.slice(2);
if (command === 'shot') await shot(args);
else if (command === 'stop') stopCommand();
else if (command === 'install') install();
else die('Usage: npm run sim -- shot <route> [<route>...] [--keep] | stop | install');
