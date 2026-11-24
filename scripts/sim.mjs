#!/usr/bin/env node
// See the app's screens without Xcode. Expo apps only. Needs "sim" in package.json "kit":
//   "sim": { "name": "<short app name>", "scheme": "<URL scheme>", "appId": "<iOS bundle identifier>" }
//
//   npm run sim -- shot <route> [<route>...] [--keep] [--as <seed user>]   screenshots to .expo/sim-shots/
//   npm run sim -- flow <name> [<name>...] [--keep]     runs Maestro flows from .maestro/ after one startup, output to .expo/sim-shots/flows/<name>/
//   npm run sim -- flow all --first-review [--keep]     every top-level .maestro/*.yaml, alphabetically. About 45 minutes,
//     so only the reviewer runs it, once per feature in the first review; without the flag it refuses.
//     A flow whose header has `tags: [fresh-seed]` gets `scripts/db.mjs reset` right before it. The run keeps going past
//     a failed flow, ends with each flow's pass or fail and time, and exits non-zero if any failed.
//   npm run sim -- stop                                 stops Metro and the device
//   npm run sim -- install                              installs the latest simulator build
//   npm run sim -- install --local                      builds the dev client with this Mac's Xcode and installs it (no EAS build)
//
// Options for shot, flow and install (stop takes --device too):
//   --device duo           the iPhone Duo simulator (iOS 27.2 iPhone19,4 runtime) instead of iPhone 16 Pro. It boots
//                          closed; fold, open or rotate it with Claude's iOS Simulator tool (set_posture, rotate).
//   --device ipad          the iPad Pro 13-inch (M5) simulator (iOS 27.2): wide layouts Maestro can tap. A flow turns
//                          it with `setOrientation`.
//   --display outer|inner  which Duo display a shot captures (default outer); the file name ends in it.
//   --dark                 dark appearance for the run, light again afterwards; shot files end in -dark. Every run
//                          sets the appearance at boot, so the simulator is light without it.
//
// The app must add a <scheme>://dev-sign-in?next=<route> route. Still unproven:
//   4. `npx eas-cli build:run -p ios --profile simulator --latest`: flags are right per --help; that it installs on DEVICE is not run.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const MAX_SIMS = 1;
const SETTLE_MS = 5000;
const METRO_TIMEOUT_MS = 120_000;
const BUNDLE_TIMEOUT_MS = 300_000;

// With this set (the Claude app sets it), Node 24.7 on macOS 27 crashes in about 1 in 10 short runs while reading
// the keychain (LoadSystemCACertificates), which fails `pod install` at random. Every child here inherits the fix.
delete process.env.NODE_USE_SYSTEM_CA;

// Options are read here, before the commands see their arguments.
const argv = process.argv.slice(2);
function option(name, takesValue) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const [, value] = argv.splice(i, takesValue ? 2 : 1);
  return takesValue ? value : true;
}
const DEVICES = { duo: 'iPhone Duo', ipad: 'iPad Pro 13-inch (M5)' };
const device = option('--device', true);
if (device !== null && !DEVICES[device]) die(`--device takes duo (the iPhone Duo) or ipad (${DEVICES.ipad}); without it, iPhone 16 Pro. Got "${device}".`);
const duo = device === 'duo';
const DEVICE = DEVICES[device] ?? 'iPhone 16 Pro';
const display = option('--display', true) ?? 'outer';
if (!['outer', 'inner'].includes(display)) die('--display is outer or inner.');
const dark = option('--dark', false);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).kit ?? {};
if (!kit.sim?.name || !kit.sim?.scheme || !kit.sim?.appId) die('package.json needs kit.sim: { "name": ..., "scheme": ..., "appId": ... }.');
const CACHE = join(homedir(), '.cache');
const LOCK = join(CACHE, `${kit.sim.name}-sim.lock`);
// Each device has its own build, so its own record of what's installed.
const FINGERPRINT = join(CACHE, `${kit.sim.name}-sim${device ? `-${device}` : ''}.json`);
const LOG = join(root, '.expo/sim-metro.log');
const SHOTS = join(root, '.expo/sim-shots');
const FLOWS = join(root, '.maestro');
const FLOW_OUT = join(SHOTS, 'flows');

function die(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

// Codex's allow rule for `npm run sim` matches only the plain command. Wrapped in pipes or redirects
// it runs inside the sandbox, where simctl can't reach CoreSimulator.
const SANDBOXED = /CoreSimulatorService connection became invalid/;

function must(cmd, args) {
  const r = run(cmd, args);
  if (!r.ok && SANDBOXED.test(r.err)) {
    die("This shell's sandbox blocks the simulator. Run `npm run sim …` as a plain command (no pipes, redirects, `;` or `&&`) so the Codex allow rule applies, or ask to run it outside the sandbox.");
  }
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

const deviceFlag = (name) => {
  const key = Object.keys(DEVICES).find((k) => DEVICES[k] === name);
  return key ? ` --device ${key}` : '';
};

function takeLock() {
  mkdirSync(CACHE, { recursive: true });
  const held = readJson(LOCK);
  if (held && held.folder !== root && isAlive(held.pid)) die(`simulator busy: ${held.folder} since ${held.since}`);
  // Also when this folder holds the lock: a --keep run may have left the other device booted.
  const others = bootedDevices().filter((name) => name !== DEVICE);
  if (others.length >= MAX_SIMS) {
    die(`simulator busy: ${others.join(', ')} is booted (limit ${MAX_SIMS}). Shut it down first`
      + (held?.folder === root ? ` (npm run sim -- stop${deviceFlag(others[0])}).` : '.'));
  }
  writeFileSync(LOCK, JSON.stringify({ folder: root, pid: process.pid, since: new Date().toISOString() }));
  if (held?.folder === root) stopMetro(held); // a --keep run left one behind
}

// ---------- native fingerprint

function currentFingerprint() {
  // 7169 = the config's version (1) + package.json scripts (1024) + .gitignore (2048) + the config's extra section (4096),
  // and eas.json is ignored. None of these change how the installed build behaves (a version bump needs no simulator
  // rebuild), and extra holds this folder's Supabase URL, which differs per worktree.
  const out = must('npx', ['@expo/fingerprint', 'fingerprint:generate', '--source-skips', '7169', '--ignore-path', 'eas.json']);
  const hash = JSON.parse(out).hash;
  if (!hash) die('Could not read the native fingerprint.');
  return hash;
}

// The first run records today's fingerprint: the installed build matches it (nothing native changed since).
// Saved as `native`, since the older `fingerprint` key also hashed .gitignore.
function checkFingerprint() {
  const now = currentFingerprint();
  const saved = readJson(FINGERPRINT)?.native;
  if (!saved) {
    writeFileSync(FINGERPRINT, JSON.stringify({ native: now }));
    return;
  }
  if (saved !== now) {
    die('Native code changed since the simulator build. Run `npm run sim -- install --local` (builds on this Mac).');
  }
}

// ---------- device and Metro

// From iOS 27, every `simctl openurl` (Maestro's openLink too) asks "Open in <app>?" unless the scheme is
// approved for simctl's bridge. The device reads the approvals at boot, so they're written before it.
function approveScheme() {
  const devices = Object.values(JSON.parse(must('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).devices).flat();
  const udid = devices.find((d) => d.name === DEVICE)?.udid;
  if (!udid) {
    die(duo
      ? 'No simulator named "iPhone Duo". Create one: xcrun simctl create "iPhone Duo" com.apple.CoreSimulator.SimDeviceType.iPhone-Duo com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4'
      : device === 'ipad'
        ? `No simulator named "${DEVICE}". Create one: xcrun simctl create "${DEVICE}" com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB com.apple.CoreSimulator.SimRuntime.iOS-27-2`
        : `No simulator named "${DEVICE}". Create one: xcrun simctl create "${DEVICE}" com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro`);
  }
  // Written as a file: the Mac's `defaults write` caches it and may never reach the disk.
  const prefs = join(homedir(), 'Library/Developer/CoreSimulator/Devices', udid, 'data/Library/Preferences/com.apple.launchservices.schemeapproval.plist');
  const approvals = existsSync(prefs) ? JSON.parse(must('plutil', ['-convert', 'json', '-o', '-', prefs])) : {};
  approvals[`com.apple.CoreSimulator.CoreSimulatorBridge-->${kit.sim.scheme}`] = kit.sim.appId;
  mkdirSync(dirname(prefs), { recursive: true });
  writeFileSync(prefs, JSON.stringify(approvals));
  must('plutil', ['-convert', 'binary1', prefs]);
}

const setAppearance = (mode) => run('xcrun', ['simctl', 'ui', DEVICE, 'appearance', mode]);

// Set on every boot, so a dark run that never got to set it back (install, a Ctrl-C) can't leak into the next one.
function bootDevice() {
  approveScheme();
  run('xcrun', ['simctl', 'boot', DEVICE]); // fails harmlessly when already booted
  must('xcrun', ['simctl', 'bootstatus', DEVICE, '-b']);
  setAppearance(dark ? 'dark' : 'light');
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

const openUrl = (url) => must('xcrun', ['simctl', 'openurl', DEVICE, url]);
const fileName = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'home';

function stopMetro(held) {
  if (!held?.pid || held.pid === process.pid) return;
  try { process.kill(-held.pid, 'SIGTERM'); } catch { /* already gone */ }
}

const restoreAppearance = () => dark && setAppearance('light');

function stopAll() {
  restoreAppearance();
  stopMetro(readJson(LOCK));
  run('xcrun', ['simctl', 'shutdown', DEVICE]);
  rmSync(LOCK, { force: true });
}

// ---------- commands

let live; // the running Maestro, stopped along with everything else on a signal

// Metro runs detached, so a Ctrl-C or a killed shell would otherwise leave Metro, the lock and the device behind.
function stopOnSignal(keep) {
  if (keep) return;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { live?.kill(); stopAll(); process.exit(1); });
}

// Boots everything and opens the app, bundled. Returns the dev client URL.
async function startApp() {
  takeLock();
  checkFingerprint(); // before booting: a rebuild message boots nothing
  // Starts the stack if needed and rewrites the env file, then refuses a non-local database.
  must(process.execPath, ['scripts/db.mjs', 'start']);
  must(process.execPath, ['scripts/db.mjs', 'guard']);
  bootDevice();
  const port = await startMetro();
  // From SDK 58 the dev menu opens over the app at every launch, and its floating button covers the
  // top-right corner, unless the launcher URL turns them off.
  const devClientUrl = `${kit.sim.scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}?disableOnboarding=1`)}&disableAutoLaunch=1&disableFab=1`;
  openUrl(devClientUrl);
  await waitForBundle();
  await sleep(SETTLE_MS);
  return devClientUrl;
}

async function shot(args) {
  const keep = args.includes('--keep');
  const asIndex = args.indexOf('--as');
  const as = asIndex >= 0 ? args[asIndex + 1] : null;
  const routes = args.filter((a, i) => a !== '--keep' && (asIndex < 0 || (i !== asIndex && i !== asIndex + 1)));
  if (!routes.length && !keep) die('Usage: npm run sim -- shot <route> [<route>...] [--keep]');
  stopOnSignal(keep);
  await startApp();
  mkdirSync(SHOTS, { recursive: true });
  for (const route of routes) {
    openUrl(`${kit.sim.scheme}://dev-sign-in?next=${encodeURIComponent(route)}${as ? `&as=${encodeURIComponent(as)}` : ''}`); 
    await sleep(SETTLE_MS);
    const file = join(SHOTS, `${fileName(route)}${dark ? '-dark' : ''}${duo ? `-${display}` : ''}.png`);
    // simctl refuses a Duo screenshot without --display: 1 is the outer display, 3 the inner.
    must('xcrun', ['simctl', 'io', DEVICE, 'screenshot', ...(duo ? [`--display=${display === 'outer' ? 1 : 3}`] : []), file]);
    console.log(file);
  }
  restoreAppearance();
  if (!keep) stopAll();
}

// Async, unlike run(), so a signal handler can run while the command does.
const runLive = (cmd, args) => new Promise((done) => {
  live = spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('close', (code) => done(code === 0));
});

function findMaestro() {
  if (run('maestro', ['--version']).ok) return 'maestro';
  const local = join(homedir(), '.maestro/bin/maestro');
  if (existsSync(local)) return local;
  return die('Maestro is not installed. Install it with: curl -fsSL "https://get.maestro.mobile.dev" | bash');
}

// The app's public Supabase URL and anon key, so a flow can check the local DB as a seed user.
function publicEnv() {
  const values = {};
  for (const line of readFileSync(join(root, kit.envFile ?? '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2];
  }
  return Object.entries(kit.envNames ?? {}).flatMap(([name, envName]) => ['-e', `${name}=${values[envName] ?? ''}`]);
}

function flowPath(name) {
  const path = resolve(existsSync(name) ? name : join(FLOWS, name.endsWith('.yaml') ? name : `${name}.yaml`));
  if (!existsSync(path)) die(`No flow at ${path}`);
  return path;
}

// Maestro's own `tags` field, in the header above the first `---`: `tags: [fresh-seed]` or one `- fresh-seed` per line.
const needsFreshSeed = (path) => /^tags:(.*\bfresh-seed\b|(\n\s+-.*)*\n\s+-\s*fresh-seed\b)/m.test(readFileSync(path, 'utf8').split(/^---$/m)[0]);

const duration = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

async function flow(args) {
  const began = Date.now();
  const keep = args.includes('--keep');
  const names = args.filter((a) => a !== '--keep' && a !== '--first-review');
  if (!names.length) die('Usage: npm run sim -- flow <name> [<name>...] [--keep] | flow all --first-review [--keep]');
  const all = names.length === 1 && names[0] === 'all';
  if (all && !args.includes('--first-review')) {
    die('`flow all` takes about 45 minutes and holds the one simulator. Name only the flows that cover your change '
      + '(the feature docs list them as `npm run sim -- flow <name>`). The reviewer runs every flow once per feature, '
      + 'in the first review, with `flow all --first-review`.');
  }
  const paths = all
    ? readdirSync(FLOWS).filter((f) => f.endsWith('.yaml')).sort().map((f) => join(FLOWS, f))
    : names.map(flowPath);
  const maestro = findMaestro();
  stopOnSignal(keep);
  const devClientUrl = await startApp();
  const startup = Date.now() - began;
  rmSync(FLOW_OUT, { recursive: true, force: true });
  const results = [];
  for (const path of paths) {
    const name = basename(path, '.yaml');
    const out = join(FLOW_OUT, name);
    mkdirSync(out, { recursive: true });
    const flowBegan = Date.now();
    let ok = true;
    if (needsFreshSeed(path)) {
      console.log(`Resetting the local database for ${name} (fresh-seed).`);
      const reset = run(process.execPath, ['scripts/db.mjs', 'reset']);
      if (!reset.ok) console.error(`Database reset failed, so ${name} didn't run: ${reset.err.trim()}`);
      ok = reset.ok;
    }
    if (ok) ok = await runLive(maestro, ['test', path, '--test-output-dir', out, '-e', `DEV_CLIENT_URL=${devClientUrl}`, ...publicEnv()]);
    results.push({ name, ok, ms: Date.now() - flowBegan });
    for (const file of readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.png')).sort()) console.log(join(out, file));
  }
  restoreAppearance();
  if (!keep) stopAll();
  const width = Math.max(...results.map((r) => r.name.length));
  console.log('');
  for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name.padEnd(width)}  ${duration(r.ms)}`);
  console.log(`Total ${duration(Date.now() - began)} (startup ${duration(startup)})`);
  const failed = results.filter((r) => !r.ok).length;
  if (failed) die(`${failed} of ${results.length} flows failed. Maestro's report and screenshots for each are in ${FLOW_OUT}/<flow>/`);
}

function stopCommand() {
  const held = readJson(LOCK);
  if (held && held.folder !== root && isAlive(held.pid)) die(`simulator busy: ${held.folder} since ${held.since}. Run stop there.`);
  stopAll();
  console.log('Simulator and Metro stopped.');
}

function install(args) {
  takeLock();
  bootDevice();
  // CocoaPods fails on a non-UTF-8 locale, and agent shells often have none set.
  const r = args.includes('--local')
    ? run('npx', ['expo', 'run:ios', '--no-bundler', '--device', DEVICE], { stdio: 'inherit', env: { LANG: 'en_US.UTF-8', ...process.env } })
    : run('npx', ['eas-cli', 'build:run', '-p', 'ios', '--profile', 'simulator', '--latest'], { stdio: 'inherit' }); // unproven (4)
  if (!r.ok) die('Install failed. See the output above.');
  writeFileSync(FINGERPRINT, JSON.stringify({ native: currentFingerprint() }));
  console.log('Simulator build installed.');
}

const [command, ...args] = argv;
if (command === 'shot') await shot(args);
else if (command === 'flow') await flow(args);
else if (command === 'stop') stopCommand();
else if (command === 'install') install(args);
else die('Usage: npm run sim -- shot <route> [<route>...] [--keep] | flow <name> [<name>...] [--keep] | flow all --first-review [--keep] | stop | install [--local]'
  + ' (shot, flow and install take [--device duo|ipad] [--display outer|inner] [--dark])');
