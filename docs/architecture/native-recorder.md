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
  tap during a prepare queues behind it natively and uses the prepared state.
- **Unpatched binaries** (old builds, Android, web, or patch-package failing on EAS):
  `warm` is undefined, nothing is prepared or released, and stop deactivates as before.

While the screen is open, other audio ducks and AirPods stay in call mode (the AirPods
mic is kept: `AllowBluetooth`).

## Interruptions

A call, Siri, or an AirPods disconnect mid-recording pauses native capture
(`deviceDisconnectionBehavior: 'pause'`). The screen's `onRecordingInterrupted` listener
calls `recorder.interrupt()`, which cancels a starting or recording attempt (no score,
file deleted) and returns true once; the screen then shows the toast "Recording
interrupted". Native sends `isPaused: true` events while idle and repeats them (one
interruption observer per past prepare), so anything but a live attempt is ignored.

## The patch

All in `ios/` unless noted. Each change carries a `Bread:` comment.

| Change | Where | Why |
|---|---|---|
| `keepSessionActive` option, default off | `RecordingSettings.swift`, `stopRecording` | Stop skips `setActive(false)` and the engine reset, so it never deactivates or delays the score |
| `audioSessionActive` flag | `AudioStreamManager` | A prepare on an active session skips `configureAudioSession`, the IO buffer hint and `setActive(true)`. The per-start tap install stays: the hardware format can change with the route |
| `releaseAudioSession` | `AudioStudioModule`, `AudioStreamManager` | On the lifecycle queue: stops the engine, removes the tap, deletes a prepared m4a, deactivates. A no-op while recording |
| Stale prepared state | `handleAudioSessionInterruption`, `handleAudioStateLost` | Interruption began, media-services reset and `AVAudioEngineConfigurationChange` clear the flag and mark a prepared state stale, so the next start prepares again |
| Settings stored after the "already prepared or recording" guard | `prepareRecording` | A stray prepare can't replace a running recording's settings |
| No leading `setActive(false)` | `prepareRecording` | `setCategory` and `setActive(true)` reconfigure in place |
| m4a recorder starts before the engine; `prepareToRecord()` or `record()` false fails the prepare or start | `prepareRecording`, `startRecording` | The backup file never starts after live audio, and a start with no m4a shows "Couldn't start recording" instead of losing the batch fallback |
| `cleanupPreparation` runs before `isPrepared` clears | `stopRecording` | Its guard read the cleared flag, so it never ran |
| No disconnect handling while idle | `handleDeviceDisconnection` | A route change with nothing recording could start the mic |
| No `compression.data` in audio events | `buildCompressionInfo` | It read and base64-encoded the m4a on the audio thread; Bread never reads it. Size bookkeeping stays |
| One sample-rate converter per recording | `resampleAudioBuffer` | A converter per buffer reset the filter at every edge. The buffer goes in once per call, then `.noDataNow` |
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
- With music playing: it ducks as the study screen opens and returns on leaving and on
  backgrounding. The orange dot is gone within about 1 s of leaving.
- Pull an AirPod while idle on Library, or on the study screen: no orange dot, no toast,
  and the next tap records from the iPhone. Mid-recording, and Siri or a call
  mid-recording: "Recording interrupted", no score, and the next tap records.
- No `<UUID>.m4a` in the app's `Documents` after leaving, including without recording.

## Decisions

- 2026-11-14 · Patch 3.2.0 rather than upgrade · Later versions need SDK 57.
- 2026-11-14 · Warm at screen open, held until leaving or backgrounding, no idle release · Caelan accepted ducking and call mode while the screen is open; an idle release would undo the warm-up for anyone reading longer before tapping.
- 2026-11-14 · `keepSessionActive` is opt-in, and the JS gate is a native constant · The library behaves like upstream unless Bread asks, and the gate holds even if the patch fails to apply on EAS.
- 2026-11-14 · AirPods disconnect pauses, and the attempt is discarded · The library's fallback restarts the engine but never the m4a recorder, so the backup file would miss the rest of the recitation.
