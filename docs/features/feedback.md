# Feedback

Two ways to tell us something. A thumbs-down on a result card reports a grade the reader thinks
is wrong, with everything about how that recitation was graded. "Send feedback" in Settings sends a
note with an optional label and up to three photos. Reports are read in the Supabase dashboard
(`feedback_reports`); there is no admin screen and no alert.

## Where things live

| Piece | File |
|---|---|
| Report button and "Sent, thank you" | `components/study/ResultCard.tsx` (`onReport`, `reported`) |
| Report sheet | `components/study/GradingReportSheet.tsx` |
| Sent state per result, sending | `app/session.tsx` (`reportedResults`) |
| Payload builder | `lib/feedback/grading-report.ts` (`buildGradingReport`), test beside it |
| Writes and limits | `lib/feedback/index.ts` (`sendGradingReport`, `sendFeedback`, `FEEDBACK_LIMITS`) |
| Retry-safe insert and upload | `lib/feedback/save.ts` (`newReportId`, `saveReport`, `uploadPhoto`) |
| Settings screen | `app/feedback.tsx`, from the "Send feedback" row at the top of `app/(tabs)/settings.tsx` |
| Schema, bucket, sweep lookup, cron | `supabase/migrations/20261117142523_feedback.sql` |
| Photo sweep | `supabase/functions/delete-feedback-photos/` |
| Tests | `supabase/tests/feedback.test.sql`, `tests/feedback-photos.integration.ts` |

## Grading reports

The thumbs-down sits left of the "?" on the card. It opens "Did we get your grading wrong?" with
one required note ("What did you say, and what did Bread mark wrong?"). Send stays disabled until
the note has text. A sent report closes the sheet and the button becomes "Sent, thank you" for that
result. The screen keeps the set of reported result objects, so a card that unmounts stays sent, and
a new recording (a retry) is a new result that can be reported again. A failed send shows an error in
the sheet and keeps the note. Nothing is queued (invariant 10).

**One report per result.** The app makes the report's `id` (`newReportId`, `lib/feedback/save.ts`)
the first time a result is reported and reuses it on every retry (`reportIds` in `app/session.tsx`).
If an insert committed but its answer was lost, the retry hits the primary key (`23505`), which
`saveReport` counts as sent, so the card shows "Sent, thank you" and there is still one row.

The report covers what the card shows: the retry if there is one, then a revealed chunk's
recitation, then the scored result. `details` is `buildGradingReport`'s output:

| Key | What |
|---|---|
| `reference`, `translation` | Book, chapter, verse range; the verse's version |
| `chunkVerses` | The chunk's first and last verse |
| `difficulty`, `chunkSize` | The session's |
| `shown` | `scored`, `retry` or `peeked` |
| `transcript`, `score` | What the reader said, and the card's score |
| `words` | One entry per alignment word, below |
| `recording` | `path` (`live` or `upload`), `liveFailure`, `model`, `durationMs` |

The row also gets the app version, update id, OS, OS version and phone model (`expo-device`).

**Licensing (invariant 2).** Correct and missing words together rebuild the verse, so verse words
are stored only for KJV. For every other translation a verse word keeps only its position `i` and
`status`, and only an `added` word keeps what was said (`word`). KJV entries also keep `word` and
`expected`. The unit test fails if a missed word of a licensed verse reaches the payload. The
transcript is stored for every translation: it is the reader's own speech.

`recording` comes from `scoreRecording` (`lib/transcription/score-recording.ts`), which records which
path won, the live session's `failure` reason, the model (the live key's, or the `model` that
`process-recording` returns) and the recording length. Grading and the fallback are unchanged.
The dev card's reports have `recording: null`.

The transcript, expected text and app version replay a grade with
`npx tsx scripts/grading-audit/run.ts --card` (`docs/grading-audit.md`).

## Settings feedback

"Send feedback" is the first row in Settings, in its own FEEDBACK section above Translation. The
screen has optional labels Idea, Bug and Other (tap again to clear), the required note, and up to
three photos from the iOS system photo picker (`expo-image-picker`, `launchImageLibraryAsync`).
That picker runs outside the app, so no permission is asked; `app.config.js` turns the plugin's
photo and camera usage strings off. Photos over the size cap are left out with a note. Send uploads
the photos, then saves the row; success shows "Thank you" and Done. A failure shows an error and
keeps the note, label and photos. The screen makes one `id` per send, and photo paths come from
it, so a retry skips photos that already landed (`409`) and a committed row (`23505`).

## Storage and access

`feedback_reports`: `kind` (`grading` or `general`), `label`, `note`, `details` (JSONB),
`photo_paths`, the app and device columns, `created_at`. `user_id` defaults to the caller and
cascades with the account. Clients can insert their own rows only, with photo paths in their own
folder; no select, update or delete. Anonymous clients get nothing.

Photos live in the private `feedback-photos` bucket at `<user id>/<report id>-<n>.<ext>`. Clients can
upload under their own folder and can't read or list anything, their own photos included.

| Limit | Value | Enforced by |
|---|---|---|
| Note | 1 to 4000 characters | table check, `maxLength` |
| Photos per report | 3 | table check, the picker's `selectionLimit` |
| Photo size | 5 MB | bucket `file_size_limit`, the screen |
| Photo type | `image/*` | bucket `allowed_mime_types` |
| `details` | 256 KB | table check |

`FEEDBACK_LIMITS` is the app's copy; the migration holds the same numbers.

## Account delete

Reports cascade with `auth.users`. Storage files don't, and SQL can't remove them: hosted Storage
refuses direct deletes from `storage.objects`, and the bytes would stay. So a daily cron
(`delete-feedback-photos`, 04:30 UTC, cron-secret bearer) asks `orphaned_feedback_photos()` for
photos whose top folder is no longer a user and removes them through the Storage API. That covers
every way an account goes: `delete_own_account()` from any app version, the dashboard, the admin API.
Photos are gone within a day. The local seed unschedules the job; call it by hand with the local
`cron_secret` from `supabase/config.toml`.

## Browser checks

- `npm run sim -- flow grading-report`: reader-a's dev result card (KJV John 11:35), thumbs-down,
  Send disabled, type, Send, "Sent, thank you". A row lands in the local `feedback_reports`.
- `npm run sim -- flow send-feedback`: Settings, Send feedback, Send disabled, Bug, type, Send,
  "Thank you", Done back to Settings. A row lands in the local `feedback_reports`.
- `tests/feedback-photos.integration.ts` on a local stack: a real upload, refused uploads (another
  folder, not an image, over 5 MB), no list or download, a send retried after it committed saves one
  row, account delete, sweep, nothing left.
- Real phone: pick photos and send (no permission prompt); report a real graded recitation and
  check `details.recording` in the dashboard.

## Decisions

- 2026-11-17 · One table for both kinds, the grading payload as JSONB · One insert path and one place to read; the payload can change without a migration.
- 2026-11-17 · Photos leave with the account through a daily sweep keyed on "the user is gone" · Works for every delete path and app version; SQL can't delete Storage files.
- 2026-11-17 · Upload first, then insert; no client read or update anywhere · A failed insert leaves files only in the reader's folder, which the sweep still covers.
- 2026-11-17 · The app makes each report's `id` and keeps it across retries; a duplicate counts as sent · A committed insert whose answer was lost would otherwise save a second report (spine Q8: one per result).
- 2026-11-17 · Non-KJV payloads keep positions and results, not words; the transcript is kept · Licensing (invariant 2); the transcript is the reader's speech (spine Q2).
