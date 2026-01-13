# Study-Session Domain

## Purpose

The core learning loop of the app. Users select verses, attempt to memorize them at different difficulty levels, record their attempts, and track progress. This is the heart of BibleMem's value proposition.

## Key Responsibilities

- Session initialization (select verses, difficulty level)
- Recording user attempts (audio capture, storage)
- Verse progression (easy → medium → hard → engraved)
- Progress tracking (accuracy scores, completion status)
- Session result evaluation and scoring
- Moving verses between difficulty tiers
- Session history and statistics

## Source Files to Review

### Frontend
- `app/session.tsx` - Main session screen
- `components/study/VerseCard.tsx` - Verse display during session
- `components/study/RecordingBar.tsx` - Audio recording UI
- `components/study/Waveform.tsx` - Audio waveform visualization
- `components/study/ProgressCard.tsx` - Progress display
- `components/study/ResultCard.tsx` - Session result screen
- `components/study/AlignmentHelpModal.tsx` - Help modal

### State Management
- `lib/store/index.ts` - Session state (progress tracking)
- `hooks/use-study-session.ts` - Session logic hook (likely large, complex)

### Backend
- `supabase/functions/process-recording/index.ts` - Recording processing, scoring logic

### Data
- `lib/bible/index.ts` - Verse data utilities
- `lib/study-chunks.ts` - Breaking verses into study chunks

## Review Focus

### Scale Issues
- Can we handle concurrent recording uploads without overwhelming the backend?
- Does progress tracking scale with 1000s of verses?
- Is the scoring algorithm efficient?
- How does the app handle slow/weak internet during recording?
- Can we replay recordings efficiently?

### Code Quality
- Is the recording logic reliable? What happens if recording fails mid-session?
- Are progress state transitions clear and bug-free? (easy → medium transitions)
- Is the scoring logic documented and correct?
- Are there race conditions when submitting recording + updating progress?
- Is error handling comprehensive for audio failures?
- Is `use-study-session.ts` too complex? Could it be split?

### Future-Proofing
- Can we easily add new difficulty levels?
- Can we add different scoring algorithms?
- Can we add time-based reviews (e.g., review verses from 6 months ago)?
- Can we add group study sessions?
- Can we replay user's previous attempts?

### Known Concerns
- `use-study-session.ts` is likely complex and needs careful review
- Recording reliability and error recovery
- Concurrent submission of recordings
- Progress state machine correctness
- Audio data storage and cleanup

## Related Sections

- `BY_LAYER/Frontend-Screens/` - Session screen
- `BY_LAYER/Components/` - Study-specific components
- `BY_LAYER/Backend-Functions/` - Recording processing
- `BY_DOMAIN/Analytics-Insights/` - Progress flows to analytics
- `BY_ARCHITECTURE/Data-Flow/` - How session data flows through app

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Study-Session/FINDINGS.md` and document your review.
