# Native recorder

Bread records through `@siteed/audio-studio` 3.2.0, changed by
`patches/@siteed+audio-studio+3.2.0.patch` (patch-package, run by `postinstall`). This
doc covers the warm audio session, interruptions and the patch. The tap sequence, live
and batch paths: `docs/features/transcription.md`.

## Warm session

Activating the iOS audio session was most of the tap-to-capture time (about 0.5–1.1 s
per tap on a phone, more for the first). On binaries with the patch, the study screen
keeps the session warm, and every chunk starts without activating it.

`recording-controls.ts` owns the rules (`createRecordingControls(onChange, warm)`, with
`warmSession` building `warm` only when the module has `breadPatch`):

- **Open.** `open()` runs the leftover sweep and the permission read, then prepares the
  recorder (`prepareRecording`, with `RECORDING_OPTIONS`, the same object as start, so
  prepare-time settings are the right ones). Only with permission already granted:
  native prepare would show the first-run prompt at screen open. A reader who grants at
  the first tap gets the warm session from that recording on.
- **Between chunks.** `keepSessionActive: true` leaves the session active at stop. No
  prepare after a chunk: the next start skips activation on its own.
- **Release.** `sleep()` on `AppState` `'background'` and on leaving calls
  `releaseAudioSession`. While an attempt owns native, the release waits for that
  attempt's stop: sent earlier, it would reach the native queue first and be a no-op.
  `wake()` prepares again on `'active'` after a background. No idle release.
- **Never twice.** No prepare while an attempt owns native or a prepare is in flight. A
  tap during a prepare queues behind it natively and uses the prepared state. A warm-up
  asked for during a prepare (a return from background, or another screen opening) runs
  once that prepare settles, unless the screen was left or backgrounded since: a release
  sent during the prepare runs natively after it.
- **Unpatched binaries** (old builds, Android, web, or patch-package failing on EAS):
  `warm` is undefined, nothing is prepared or released, and stop deactivates as before.

While the screen is open, other audio ducks and AirPods stay in call mode (the AirPods
mic is kept: `AllowBluetooth`).

## Interruptions

A call, Siri, or an AirPods disconnect mid-recording pauses native capture
(`deviceDisconnectionBehavior: 'pause'`). The screen's `onRecordingInterrupted` listener
calls `recorder.interrupt()`, which cancels a starting or recording attempt (no score,
file deleted) and returns true once; the screen then shows the toast "Recording
interrupted". Native sends `isPaused: true` events while idle, so anything but a live attempt is
ignored.

## The patch

All in `ios/` unless noted. Each change carries a `Bread:` comment.

| Change | Where | Why |
|---|---|---|
| `keepSessionActive` option, default off | `RecordingSettings.swift`, `stopRecording` | Stop skips `setActive(false)` and the engine reset, so it never deactivates or delays the score |
| `audioSessionActive` flag | `AudioStreamManager` | A prepare on an active session skips `configureAudioSession`, the IO buffer hint and `setActive(true)`. The per-start tap install stays: the hardware format can change with the route |
| `releaseAudioSession` | `AudioStudioModule`, `AudioStreamManager` | On the lifecycle queue: stops the engine, removes the tap, deletes a prepared m4a, deactivates. A no-op while recording, and otherwise always deactivates: a failed prepare or an engine configuration change clears the flag but leaves the session active. It hops to main first, as prepare and start do in `checkMicrophonePermission`, so it can't overtake an in-flight prepare |
| Stale prepared state | `handleAudioSessionInterruption`, `handleAudioStateLost` | Interruption began, media-services reset and `AVAudioEngineConfigurationChange` clear the flag and mark a prepared state stale. The next start drops it without `setActive(false)` and prepares again in place, so an AirPods switch to call mode after the screen-open prepare doesn't cost an off-and-on cycle |
| Settings stored after the "already prepared or recording" guard | `prepareRecording` | A stray prepare can't replace a running recording's settings |
| No leading `setActive(false)` | `prepareRecording` | `setCategory` and `setActive(true)` reconfigure in place |
| m4a recorder starts before the engine; `prepareToRecord()` or `record()` false fails the prepare or start | `prepareRecording`, `startRecording` | The backup file never starts after live audio, and a start with no m4a shows "Couldn't start recording" instead of losing the batch fallback |
| `cleanupPreparation` runs before `isPrepared` clears | `stopRecording` | Its guard read the cleared flag, so it never ran |
| One interruption observer, registered at init | `prepareRecording` | Prepare added another each time, so one interruption reached JS once per past prepare |
| No disconnect handling while idle | `handleDeviceDisconnection` | A route change with nothing recording could start the mic |
| No `compression.data` in audio events | `buildCompressionInfo` | It read and base64-encoded the m4a on the audio thread; Bread never reads it. Size bookkeeping stays |
| One sample-rate converter per recording | `resampleAudioBuffer` | A converter per buffer reset the filter at every edge. The buffer goes in once per call, then `.noDataNow` |
| No tap with an invalid input format (0 channels or 0 Hz); prepare and start fail instead | `installTapWithHardwareFormat` and its callers | Port of upstream audiolab #417 (3.2.1): a fresh permission grant or a Bluetooth handoff could report that format, and the synthetic fallback tap crashed |
| Dev timings | `breadMark`, `#if DEBUG` | Debug builds return `breadTimings` from `stopRecording`: ms from the start call to `queue`, the path (`prepared`, `stale`, `warm`, `cold`), `category`, `bufferHint`, `active`, `tap`, `m4aPrepared`, `record`, `engine`, `firstBuffer`. Release builds compile none of it |
| `breadPatch` constant (1) | `AudioStudioModule` | The JS gate |
| `keepSessionActive` in the TS types | `src/`, `build/types/` | No casts |
| No "Adding recording interruption listener" log | `events.{js,ts}` | Noise |

## Shipping

The `fingerprint` runtime policy hashes `patches/`, so a patch change routes the merge
to an App Store build, and JS that needs it never reaches older binaries over the air
(`docs/architecture/release.md`). `breadPatch` covers what the hash can't: patch-package
failing on EAS.

To change the patch: edit `node_modules/@siteed/audio-studio`, run
`npx patch-package @siteed/audio-studio`, reinstall the package from scratch and check it
applies. A new dev build is needed to test it; the simulator records, but timing, the
orange dot, AirPods and interruptions need a phone.

## Browser checks

Needs a person and a phone with a patched dev build.

- The first tap after reading for a minute starts as fast as chunk 2 onward
  (`[MIC] →resolve`), with the built-in mic and with AirPods.
- With AirPods, the first tap's `[MIC] native` names `prepared`. `stale` means the
  switch to call mode invalidated the screen-open prepare, so the first tap prepared
  again; `cold` means it wasn't prepared at all.
- With music playing: it ducks as the study screen opens and returns on leaving and on
  backgrounding. The orange dot is gone within about 1 s of leaving.
- Pull an AirPod while idle on Library, or on the study screen: no orange dot, no toast,
  and the next tap records from the iPhone. Mid-recording, and Siri or a call
  mid-recording: "Recording interrupted", no score, and the next tap records.
- No `<UUID>.m4a` in the app's `Documents` after leaving, including without recording.
- The `[MIC]` line after each take: `native` names the slow step. Audio pieces are about
  3,200 B (100 ms) or 1,600 B (50 ms); note which. `B/s` is about 31,000 to 32,000.
  Between a short and a long take, the m4a should grow about 8 KB per extra second
  (64 kbps). The simulator adds a fixed ~60 KB per file, so one take's size alone misleads.

## Decisions

- 2026-11-14 · Patch 3.2.0 rather than upgrade · 3.2.1 and 4.0.0-beta.0 declare `expo >=52` like 3.2.0, so the SDK doesn't block an upgrade, but 3.2.1's only fix Bread needs (#417) is ported and 4.0 is a beta. Upgrading means re-porting this patch.
- 2026-11-14 · Warm at screen open, held until leaving or backgrounding, no idle release · Caelan accepted ducking and call mode while the screen is open; an idle release would undo the warm-up for anyone reading longer before tapping.
- 2026-11-14 · `keepSessionActive` is opt-in, and the JS gate is a native constant · The library behaves like upstream unless Bread asks, and the gate holds even if the patch fails to apply on EAS.
- 2026-11-14 · AirPods disconnect pauses, and the attempt is discarded · The library's fallback restarts the engine but never the m4a recorder, so the backup file would miss the rest of the recitation.
