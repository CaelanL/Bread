import { getAuthToken, getSupabaseUrl } from '@/lib/api/client';

export type LiveSessionState =
  | 'connecting'
  | 'streaming'
  | 'failed'
  | 'closed';

export interface LiveTranscriptionSession {
  readonly state: LiveSessionState;
  feedAudio(chunk: Uint8Array): void;
  finish(timeoutMs: number): Promise<string>;
  abort(): void;
}

export interface LiveAudioFormat {
  sampleRate: number;
  channels: number;
}

interface LiveKey {
  apiKey: string;
  websocketUrl: string;
  model: string;
}

interface SonioxToken {
  text: string;
  is_final: boolean;
}

interface SonioxMessage {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: string;
  error_message?: string;
}

// Users speak the instant recording starts, but mint + connect takes
// ~350ms — audio fed before the socket is ready is buffered and flushed
// on open (Soniox ingests faster than real-time and catches up). The cap
// bounds a stalled connect; overflow fails the session → batch fallback.
const MAX_BUFFER_SECONDS = 15;

// Hedge between finish() and sending end-of-audio. The recorder's
// trailing PCM chunk (≤100ms) is emitted inside native stopRecording()
// before its promise resolves, but can still be processed on JS after
// the resolve (iOS: resolve is an Immediate-priority task, the chunk
// Normal; Android: the chunk hops through the main thread first) — and
// so after finish() is called. This grace lets that late chunk feed
// before the end frame; a tail that misses it is not scored, which
// clips the last word. Load-bearing: the screen's live-feed
// subscription depends on it (app/session.tsx).
const FLUSH_GRACE_MS = 50;

// KEY_TTL_SECONDS (300) in transcription-token, less 30s. Age counts from when
// the key reached the device, not from expiresAt, so device clock skew can't
// make a fresh key look stale or a dead one look fresh.
const KEY_REUSE_MS = 270_000;

/**
 * One study screen's Soniox key. The screen creates it on mount and warms it,
 * so the first tap usually finds a key ready. Only one mint runs at a time, and
 * a stale key is replaced before a socket opens.
 */
export class LiveKeyCache {
  private key: { value: LiveKey; receivedAt: number } | null = null;
  private minting: Promise<LiveKey> | null = null;

  warm(): void {
    this.get().catch(() => {});
  }

  get(): Promise<LiveKey> {
    if (this.key && Date.now() - this.key.receivedAt < KEY_REUSE_MS) {
      return Promise.resolve(this.key.value);
    }
    this.minting ??= this.mint().finally(() => { this.minting = null; });
    return this.minting;
  }

  drop(key: LiveKey): void {
    if (this.key?.value === key) this.key = null;
  }

  private async mint(): Promise<LiveKey> {
    const token = await getAuthToken();
    const res = await fetch(`${getSupabaseUrl()}/functions/v1/transcription-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 403 LIVE_DISABLED (the kill switch) lands here too
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    const value: LiveKey = await res.json();
    this.key = { value, receivedAt: Date.now() };
    return value;
  }
}

class LiveSession implements LiveTranscriptionSession {
  state: LiveSessionState = 'connecting';

  private ws: WebSocket | null = null;
  private buffer: Uint8Array[] = [];
  private bufferedBytes = 0;
  private readonly maxBufferBytes: number;
  private finalTexts: string[] = [];
  private bytesFed = 0;
  private finishResolve: ((transcript: string) => void) | null = null;
  private finishReject: ((error: Error) => void) | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private key: LiveKey | null = null;
  // Soniox has answered without an error, so the key works
  private keyAccepted = false;

  constructor(
    private readonly verseText: string,
    private readonly keys: LiveKeyCache,
    private readonly format: LiveAudioFormat
  ) {
    this.maxBufferBytes =
      MAX_BUFFER_SECONDS * format.sampleRate * format.channels * 2;
    this.connect();
  }

  private async connect(): Promise<void> {
    let key: LiveKey;
    try {
      key = await this.keys.get();
    } catch (e) {
      this.fail(`mint failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
    if (this.state !== 'connecting') return; // aborted during mint
    this.key = key;
    const config = JSON.stringify({
      model: key.model,
      audio_format: 'pcm_s16le',
      sample_rate: this.format.sampleRate,
      num_channels: this.format.channels,
      language_hints: ['en'],
      context: {
        general: [
          { key: 'domain', value: 'Bible' },
          { key: 'topic', value: 'Bible verse memory recitation attempt' },
        ],
        text: this.verseText,
      },
    });

    // Soniox refuses a key sent only in the config frame from 15 January 2027
    const ws = new WebSocket(key.websocketUrl, ['soniox-api-key', key.apiKey]);
    this.ws = ws;

    ws.onopen = () => {
      if (this.state !== 'connecting') {
        ws.close();
        return;
      }
      ws.send(config);
      // Flush the backlog as individual chunks (not one giant frame)
      for (const chunk of this.buffer) {
        ws.send(chunk);
      }
      this.buffer = [];
      this.bufferedBytes = 0;
      this.state = 'streaming';
    };

    ws.onmessage = (event) => {
      let msg: SonioxMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.error_code) {
        this.fail(`${msg.error_code}: ${msg.error_message}`);
        return;
      }
      this.keyAccepted = true;
      for (const t of msg.tokens ?? []) {
        if (t.is_final && t.text !== '<fin>' && t.text !== '<end>') {
          this.finalTexts.push(t.text);
        }
      }
      if (msg.finished) {
        const transcript = this.finalTexts.join('');
        if (transcript.trim() === '') {
          // Audio was fed but produced no tokens (bad input route, near
          // silence) — an empty transcript would score 0; let the batch
          // model try the file instead
          this.fail('empty transcript');
          return;
        }
        this.state = 'closed';
        this.ws = null;
        ws.close();
        this.finishResolve?.(transcript);
        this.clearFinishHandlers();
      }
    };

    ws.onerror = () => this.fail('socket error');
    ws.onclose = () => {
      if (this.state === 'connecting' || this.state === 'streaming') {
        this.fail('socket closed unexpectedly');
      }
    };
  }

  feedAudio(chunk: Uint8Array): void {
    this.bytesFed += chunk.byteLength;
    if (this.state === 'streaming') {
      this.ws?.send(chunk);
    } else if (this.state === 'connecting') {
      this.bufferedBytes += chunk.byteLength;
      if (this.bufferedBytes > this.maxBufferBytes) {
        this.fail('connect stalled, buffer cap hit');
        return;
      }
      this.buffer.push(chunk);
    }
    // failed/closed: no-op — the batch path has the file
  }

  finish(timeoutMs: number): Promise<string> {
    if (this.state === 'failed' || this.state === 'closed') {
      return Promise.reject(new Error('live session unavailable'));
    }
    if (this.state === 'connecting') {
      // The socket never opened (dead network, slow mint): batch has the
      // whole file, so don't wait for a connection
      this.fail('never opened');
      return Promise.reject(new Error('never opened'));
    }
    return new Promise<string>((resolve, reject) => {
      this.finishResolve = resolve;
      this.finishReject = reject;
      this.graceTimer = setTimeout(() => {
        if (this.bytesFed === 0) {
          // PCM capture never delivered audio, even the trailing chunk: an
          // empty transcript would score 0, so batch scores the file instead
          this.fail('no audio was fed');
          return;
        }
        this.ws?.send(''); // end-of-audio
      }, FLUSH_GRACE_MS);
      this.timeoutTimer = setTimeout(() => {
        if (this.finishReject) {
          this.fail('finalize timeout');
        }
      }, timeoutMs);
    });
  }

  abort(): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    this.state = 'closed';
    this.teardown();
    this.finishReject?.(new Error('aborted'));
    this.clearFinishHandlers();
  }

  private fail(reason: string): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    // eslint-disable-next-line no-console -- routine fallback, not a problem; console.warn would raise a LogBox in dev
    console.log(`[LIVE] falling back to batch: ${reason}`);
    // Never reuse a key Soniox may have refused
    if (this.key && !this.keyAccepted) this.keys.drop(this.key);
    this.state = 'failed';
    this.teardown();
    this.finishReject?.(new Error(reason));
    this.clearFinishHandlers();
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.buffer = [];
    this.bufferedBytes = 0;
  }

  private clearFinishHandlers(): void {
    this.finishResolve = null;
    this.finishReject = null;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}

/**
 * Start a background live-transcription stream for one recording.
 *
 * Returns synchronously so audio can be fed from the first PCM callback —
 * chunks are buffered while the key + WebSocket connect complete,
 * then flushed. Every failure mode (mint refused, socket drop, finalize
 * timeout, buffer overflow) resolves to state "failed" with no error UI:
 * the caller's batch path scores the recording file instead.
 */
export function startLiveTranscription(
  verseText: string,
  keys: LiveKeyCache,
  format: LiveAudioFormat = { sampleRate: 16000, channels: 1 }
): LiveTranscriptionSession {
  return new LiveSession(verseText, keys, format);
}

const B64_LOOKUP = (() => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  return lookup;
})();

// The native bridge delivers PCM chunks as base64; Hermes has no Buffer
// and atob availability varies, so decode by hand.
export function base64ToUint8Array(base64: string): Uint8Array {
  let end = base64.length;
  while (end > 0 && base64.charCodeAt(end - 1) === 61 /* '=' */) end--;
  const byteLength = Math.floor((end * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  let bits = 0;
  let bitCount = 0;
  for (let i = 0; i < end; i++) {
    bits = (bits << 6) | B64_LOOKUP[base64.charCodeAt(i) & 127];
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[byteIndex++] = (bits >> bitCount) & 0xff;
    }
  }
  return bytes;
}
