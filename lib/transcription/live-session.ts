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

interface TokenEndpointResponse {
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

// The recorder's trailing PCM chunk is emitted inside native
// stopRecording() before its promise resolves, so on iOS it is already
// ahead of the resolve in the JS event queue (verified in
// AudioStreamManager.swift — the delegate emit is synchronous inside
// stop). On Android the emit goes through an async mainHandler.post
// while the promise resolves separately, so strict ordering isn't
// guaranteed — keep one main-loop hop of hedge. Soniox ignores audio
// after the end frame, so losing this race would clip the last word.
const FLUSH_GRACE_MS = 50;

class LiveSession implements LiveTranscriptionSession {
  state: LiveSessionState = 'connecting';

  private ws: WebSocket | null = null;
  private buffer: Uint8Array[] = [];
  private bufferedBytes = 0;
  private readonly maxBufferBytes: number;
  private finalTexts: string[] = [];
  private bytesFed = 0;
  private finishRequested = false;
  private finishResolve: ((transcript: string) => void) | null = null;
  private finishReject: ((error: Error) => void) | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly verseText: string,
    private readonly format: LiveAudioFormat
  ) {
    this.maxBufferBytes =
      MAX_BUFFER_SECONDS * format.sampleRate * format.channels * 2;
    this.connect();
  }

  private async connect(): Promise<void> {
    let config: string;
    let websocketUrl: string;
    try {
      const token = await getAuthToken();
      const res = await fetch(
        `${getSupabaseUrl()}/functions/v1/transcription-token`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        // 403 LIVE_DISABLED (the kill switch) lands here too
        this.fail(`token endpoint ${res.status}`);
        return;
      }
      const minted: TokenEndpointResponse = await res.json();
      websocketUrl = minted.websocketUrl;
      config = JSON.stringify({
        api_key: minted.apiKey,
        model: minted.model,
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
    } catch (e) {
      this.fail(`mint failed: ${e}`);
      return;
    }
    if (this.state !== 'connecting') return; // aborted during mint

    const ws = new WebSocket(websocketUrl);
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
      if (this.finishRequested) {
        ws.send(''); // end-of-audio
      }
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
    if (this.bytesFed === 0) {
      // PCM capture never delivered audio — an empty transcript here
      // would score 0; let the batch path score the file instead
      this.fail('no audio was fed');
      return Promise.reject(new Error('no audio was fed'));
    }
    return new Promise<string>((resolve, reject) => {
      this.finishResolve = resolve;
      this.finishReject = reject;
      this.graceTimer = setTimeout(() => {
        this.finishRequested = true;
        if (this.state === 'streaming') {
          this.ws?.send(''); // end-of-audio; connecting sends it on flush
        }
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
    console.log(`[LIVE] falling back to batch: ${reason}`);
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
 * chunks are buffered while the token mint + WebSocket connect complete,
 * then flushed. Every failure mode (mint refused, socket drop, finalize
 * timeout, buffer overflow) resolves to state "failed" with no error UI:
 * the caller's batch path scores the recording file instead.
 */
export function startLiveTranscription(
  verseText: string,
  format: LiveAudioFormat = { sampleRate: 16000, channels: 1 }
): LiveTranscriptionSession {
  return new LiveSession(verseText, format);
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
