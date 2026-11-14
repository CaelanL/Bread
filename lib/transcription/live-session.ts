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

// Soniox closes a socket that hears nothing for 40s before its start request.
// Held time before the config frame isn't billed, and the session cap counts
// from config (research/soniox-held-socket-test.md in the feature's notes).
const KEEPALIVE_MS = 10_000;

interface Spare {
  ws: WebSocket;
  key: LiveKey;
  open: boolean;
  keepalive?: ReturnType<typeof setInterval>;
  recycle?: ReturnType<typeof setTimeout>;
}

/**
 * One study screen's live transcription standby: a Soniox key and a spare
 * socket opened ahead of the tap, so a recording streams into an open
 * connection. Only one mint runs at a time, and a stale key is replaced before
 * a socket opens. Each socket carries one recording; the next spare opens when
 * that recording's session ends.
 */
export class LiveStandby {
  private key: { value: LiveKey; receivedAt: number } | null = null;
  private minting: Promise<LiveKey> | null = null;
  private spare: Spare | null = null;
  private opening = false;
  private reopened = false;
  private asleep = false;
  private disposed = false;
  // The last mint failed (LIVE_DISABLED, offline): no spares until a mint works
  private keyless = false;

  /** Screen open and app back in the foreground. */
  warm(): void {
    this.asleep = false;
    this.disposed = false;
    this.reopened = false;
    this.keyless = false;
    void this.openSpare();
  }

  /** App in the background: close the spare until the next warm. */
  sleep(): void {
    this.asleep = true;
    this.closeSpare();
  }

  /** Screen gone. */
  dispose(): void {
    this.disposed = true;
    this.sleep();
  }

  /** A recording's session ended: get the next spare ready. */
  replenish(): void {
    this.reopened = false;
    void this.openSpare();
  }

  /** The spare, if its key is still good; Soniox checks the key at config. */
  takeSpare(): Spare | null {
    const spare = this.spare;
    if (!spare) return null;
    if (!this.isFresh(spare.key)) {
      this.closeSpare();
      return null;
    }
    this.spare = null;
    this.stopTending(spare);
    return spare;
  }

  get(): Promise<LiveKey> {
    if (this.key && this.isFresh(this.key.value)) {
      return Promise.resolve(this.key.value);
    }
    this.minting ??= this.mint().finally(() => { this.minting = null; });
    return this.minting;
  }

  private isFresh(key: LiveKey): boolean {
    return this.key?.value === key && Date.now() - this.key.receivedAt < KEY_REUSE_MS;
  }

  private keyLeftMs(key: LiveKey): number {
    return this.key?.value === key ? KEY_REUSE_MS - (Date.now() - this.key.receivedAt) : 0;
  }

  drop(key: LiveKey): void {
    if (this.key?.value === key) this.key = null;
  }

  private async mint(): Promise<LiveKey> {
    try {
      const token = await getAuthToken();
      const res = await fetch(`${getSupabaseUrl()}/functions/v1/transcription-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      // 403 LIVE_DISABLED (the kill switch) lands here too
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      const value: LiveKey = await res.json();
      this.key = { value, receivedAt: Date.now() };
      this.keyless = false;
      return value;
    } catch (e) {
      this.keyless = true;
      throw e;
    }
  }

  private async openSpare(): Promise<void> {
    if (this.spare || this.opening || this.asleep || this.disposed || this.keyless) return;
    this.opening = true;
    let key: LiveKey;
    try {
      key = await this.get();
    } catch {
      return; // no spare; a tap mints for itself
    } finally {
      this.opening = false;
    }
    if (this.spare || this.asleep || this.disposed) return;
    const spare: Spare = { ws: openSocket(key), key, open: false };
    this.spare = spare;
    // Replace the spare, with a fresh key, before its key goes stale
    spare.recycle = setTimeout(() => {
      this.closeSpare();
      void this.openSpare();
    }, this.keyLeftMs(key));
    spare.ws.onopen = () => {
      spare.open = true;
      const keepalive = JSON.stringify({ type: 'keepalive' });
      spare.keepalive = setInterval(() => spare.ws.send(keepalive), KEEPALIVE_MS);
    };
    spare.ws.onerror = spare.ws.onclose = () => {
      if (this.spare !== spare) return;
      // Nothing comes back before the start request, so Soniox may have
      // refused the key: never reuse it
      this.drop(key);
      this.closeSpare();
      if (this.reopened) return; // repeated drops wait for the next recording
      this.reopened = true;
      void this.openSpare();
    };
  }

  private closeSpare(): void {
    const spare = this.spare;
    if (!spare) return;
    this.spare = null;
    this.stopTending(spare);
    try {
      spare.ws.close();
    } catch {
      // already closed
    }
  }

  private stopTending(spare: Spare): void {
    clearInterval(spare.keepalive);
    clearTimeout(spare.recycle);
    spare.ws.onopen = spare.ws.onerror = spare.ws.onclose = null;
  }
}

// Soniox refuses a key sent only in the config frame from 15 January 2027
function openSocket(key: LiveKey): WebSocket {
  return new WebSocket(key.websocketUrl, ['soniox-api-key', key.apiKey]);
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
    private readonly standby: LiveStandby,
    private readonly format: LiveAudioFormat
  ) {
    this.maxBufferBytes =
      MAX_BUFFER_SECONDS * format.sampleRate * format.channels * 2;
    this.connect();
  }

  private async connect(): Promise<void> {
    const spare = this.standby.takeSpare();
    if (spare) {
      this.attach(spare.ws, spare.key, spare.open);
      return;
    }
    let key: LiveKey;
    try {
      key = await this.standby.get();
    } catch (e) {
      this.fail(`mint failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
    if (this.state !== 'connecting') return; // aborted during mint
    this.attach(openSocket(key), key, false);
  }

  private attach(ws: WebSocket, key: LiveKey, open: boolean): void {
    this.key = key;
    this.ws = ws;
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

    const start = () => {
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
    ws.onopen = start;

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
        this.standby.replenish();
      }
    };

    ws.onerror = () => this.fail('socket error');
    ws.onclose = () => {
      if (this.state === 'connecting' || this.state === 'streaming') {
        this.fail('socket closed unexpectedly');
      }
    };
    if (open) start();
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
    this.standby.replenish();
  }

  private fail(reason: string): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    // eslint-disable-next-line no-console -- routine fallback, not a problem; console.warn would raise a LogBox in dev
    console.log(`[LIVE] falling back to batch: ${reason}`);
    // Never reuse a key Soniox may have refused
    if (this.key && !this.keyAccepted) this.standby.drop(this.key);
    this.state = 'failed';
    this.teardown();
    this.finishReject?.(new Error(reason));
    this.clearFinishHandlers();
    this.standby.replenish();
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
  standby: LiveStandby,
  format: LiveAudioFormat = { sampleRate: 16000, channels: 1 }
): LiveTranscriptionSession {
  return new LiveSession(verseText, standby, format);
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
