// lib-ok: dev-only timing harness (added latency, [PERF] log lines) for startup measurements, local Supabase only
import AsyncStorage from '@react-native-async-storage/async-storage';

import { canDevSignIn } from '@/lib/auth/dev-sign-in';

const LATENCY_KEY = 'dev_latency_ms';
const PERF_KEY = 'dev_perf';

/** False in release builds and against any non-local Supabase, so none of this runs there. */
export const DEV_TIMING = typeof __DEV__ !== 'undefined' && __DEV__ && canDevSignIn(true, process.env.EXPO_PUBLIC_SUPABASE_URL);

let origin = performance.now();
let settings: Promise<{ latency: number; perf: boolean }> | null = null;
const marked = new Set<string>();

function readSettings() {
  settings ??= Promise.all([AsyncStorage.getItem(LATENCY_KEY), AsyncStorage.getItem(PERF_KEY)])
    .then(([latency, perf]) => ({ latency: Number(latency) || 0, perf: perf === '1' }))
    .catch(() => ({ latency: 0, perf: false }));
  return settings;
}

const since = () => Math.round(performance.now() - origin);

/** Set by `dev-sign-in?latency=<ms>&perf=1`; read once per launch. */
export async function saveDevTiming(latency: number, perf: boolean) {
  if (!DEV_TIMING) return;
  await AsyncStorage.multiSet([[LATENCY_KEY, String(latency)], [PERF_KEY, perf ? '1' : '0']]);
  settings = Promise.resolve({ latency, perf });
}

/** Logs `[PERF] mark <name> <ms>` once per launch. `root` resets the clock. */
export function perfMark(name: string) {
  if (!DEV_TIMING || marked.has(name)) return;
  marked.add(name);
  if (name === 'root') origin = performance.now();
  const at = since();
  void readSettings().then(({ perf }) => {
    if (perf) console.log(`[PERF] mark ${name} ${at}`);
  });
}

/** `fetch` for Supabase and the Bible function: in dev against a local Supabase, delayed and logged per the saved settings. */
export const timedFetch: typeof fetch = async (input, init) => {
  if (!DEV_TIMING) return fetch(input, init);
  const { latency, perf } = await readSettings();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const start = since();
  if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
  try {
    return await fetch(input, init);
  } finally {
    if (perf) {
      const { pathname, search } = new URL(url);
      console.log(`[PERF] req ${init?.method ?? 'GET'} ${pathname}${search.slice(0, 80)} ${start} ${since()}`);
    }
  }
};
