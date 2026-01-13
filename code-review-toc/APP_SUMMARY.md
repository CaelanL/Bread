# BibleMem App Summary

## Overview

BibleMem is a mobile app (React Native + Expo) designed to help users memorize Bible verses through spaced repetition and progressive difficulty levels. Users can organize verses into collections, attempt to memorize them at varying difficulty levels, and track their progress with analytics.

**Status**: ~90% complete, transitioning from MVP to production-ready.

## Core Value Proposition

Help users efficiently memorize scripture by:
1. Organizing verses into personal collections
2. Recording practice attempts at three difficulty levels (easy → medium → hard)
3. Progressing verses to "engraved" mastery after consistent performance
4. Tracking streaks, practice time, and mastery progress
5. Accessing multiple Bible versions (ESV, NLT, KJV)

## Key Features

### 1. Authentication
- Email/password sign-up and sign-in
- Password recovery
- Session persistence across app restarts
- Backend: Supabase Auth

### 2. Library Management
- Create custom collections of verses
- Add verses from any Bible book/chapter
- Organize and remove verses from collections
- Rename and customize collections
- Default "My Verses" collection

### 3. Study Session (Core Loop)
- Select verses to study
- Choose difficulty level: Easy, Medium, Hard, Engraved
- Record voice attempt
- Auto-scoring based on verse alignment
- Progress tracking (accuracy, completion status)
- Move verses between difficulty tiers based on performance

### 4. Analytics & Insights
- Streak tracking (consecutive study days)
- Total practice time
- Verses mastered count
- Average time to master
- Vault of the Month (VotM) - featured verse/month
- User statistics dashboard

### 5. Settings
- Light/Dark theme toggle
- Bible version selection (ESV, NLT, KJV)
- User preferences

### 6. Bible Data
- Multiple Bible versions (ESV, NLT, KJV)
- Verse fetching with proper text formatting
- Local caching of frequently accessed verses
- Support for local KJV (1769 edition)

## Tech Stack

### Frontend
- **Framework**: React Native with Expo
- **Navigation**: Expo Router (file-based routing)
- **State Management**: Zustand
- **UI Components**: Custom React Native components
- **Styling**: React Native StyleSheet + theme system
- **Language**: TypeScript

### Backend
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Functions**: Supabase Edge Functions (Deno)
- **Storage**: Supabase Storage (for recordings/images)
- **Hosting**: Supabase

### Client-Side Storage
- **Local Persistence**: @react-native-async-storage/async-storage
- **In-Memory Cache**: Session cache for Bible verses

### Recording & Audio
- **Audio Capture**: expo-av
- **Processing**: Backend edge function scores recordings

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         React Native (Expo)              │
│  - Screens, Components, UI Logic        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│       State Management (Zustand)        │
│  - Collections, Verses, Settings        │
│  - Loading states, Errors               │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│   Data Sync & Local Storage             │
│  - AsyncStorage persistence             │
│  - Local ↔ Server sync logic            │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    API Layer (Supabase Client)          │
│  - Bible fetch, Recording submit        │
│  - Analytics calls, Data operations     │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Backend (Supabase Edge Functions)      │
│  - Bible routing (ESV/NLT/KJV)         │
│  - Recording processing & scoring      │
│  - Analytics aggregation (cron)        │
│  - RLS policies for security           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    Database (PostgreSQL)                │
│  - Users, Collections, Verses           │
│  - Session attempts, Progress           │
│  - Analytics aggregates                 │
└─────────────────────────────────────────┘
```

## Data Model (Simplified)

### Core Entities
- **User**: Authentication, preferences
- **Collection**: User's verse collection with metadata
- **Verse**: Bible verse with reference (book, chapter, verse)
- **UserVerse**: Maps users to verses (progress tracking)
- **SessionAttempt**: Records of study attempts with scores
- **UserStats**: Aggregated analytics (streaks, totals)

### Relationships
- User → Collections (one-to-many)
- User → UserVerse (one-to-many)
- Collection ↔ Verse (many-to-many via UserVerse)
- UserVerse → SessionAttempt (one-to-many)

## Key User Flows

### 1. First Time User Flow
1. Sign up with email
2. Create "My Verses" collection (auto-created)
3. Add first verses (browse Bible)
4. Start first study session
5. Record attempt, get immediate feedback

### 2. Study Session Flow
1. Navigate to Library, open collection
2. Select verses to study
3. Choose difficulty (Easy/Medium/Hard)
4. Enter study session
5. Record voice attempt
6. See auto-score and feedback
7. Verse progresses based on accuracy
8. Return to library

### 3. Track Progress Flow
1. View Home screen analytics
2. See streak, practice time, mastered count
3. Navigate to Insights for detailed stats
4. See Vault of the Month featured verse

## Known Limitations & Technical Debt

> **Note**: This section should be filled in based on code review findings. Current version is placeholder.

- Likely has `any` types that should be fixed
- May have lazy patterns that need proper implementation
- Scale considerations for 10k+ users
- Potential performance optimizations
- Type safety gaps

---

## Next Steps for Production Readiness

This ToC is designed to systematically review the codebase from three perspectives (Domain, Layer, Architecture) to identify and address:

1. Scale issues (can this handle 100k+ users?)
2. Code quality issues (is this production-grade code?)
3. Future-proofing issues (can we add features without refactoring?)
4. Architectural concerns (is the system resilient and extensible?)

See individual review sections in the ToC for detailed guidance.

---

## Document Notes

**Last Updated**: During code review ToC creation
**Status**: DRAFT - To be refined during actual code review
**Reviewer**: [Agent name will fill in]

To refine this summary, see the review instructions and pick a starting point:
- Start with **BY_DOMAIN/** for feature-centric review
- Start with **BY_LAYER/** for technical layer review  
- Start with **BY_ARCHITECTURE/** for system-wide concerns
