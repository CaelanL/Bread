# Analytics-Insights Domain

## Purpose

Tracks and displays user engagement metrics, learning progress, streaks, practice statistics, and provides insights into the user's study habits and performance.

## Key Responsibilities

- Track session attempts and results
- Calculate and maintain streaks (consecutive study days)
- Track total practice time and verses mastered
- Calculate average time to master verses
- Display user statistics and progress
- Vault of the Month (VotM) selection and display
- User statistics across all collections

## Source Files to Review

### Frontend
- `app/(tabs)/home.tsx` - Home screen with stats display
- `app/(tabs)/insights.tsx` - Detailed insights screen
- `components/home/InsightsCard.tsx` - Stats card component
- `components/home/VOTMCard.tsx` - Vault of the Month card

### State Management
- `lib/store/index.ts` - Analytics state (check stats fields)
- `hooks/use-streak.ts` - Streak calculation hook
- `hooks/use-count-up.ts` - Animated counter hook

### Backend
- `lib/api/analytics.ts` - Analytics API calls
- `supabase/functions/_shared/usage.ts` - May contain analytics logic
- `supabase/migrations/011_user_stats_cron.sql` - Stats cron job

## Review Focus

### Scale Issues
- How are stats calculated? Is it efficient at scale?
- Are we aggregating data in the database or fetching and computing client-side?
- Does the stats cron job handle 100k+ users efficiently?
- Are analytics queries indexed properly?
- Does real-time streak calculation scale?

### Code Quality
- Are streak calculations correct? (edge cases: timezone, dates, etc.)
- Are stats aggregations correct? (no double-counting?)
- Is error handling comprehensive when fetching stats?
- Are there gaps in tracking (sessions that happen but aren't counted)?
- Is the analytics data consistent with actual session data?

### Future-Proofing
- Can we easily add new metrics?
- Can we add historical trends (stats over time)?
- Can we add comparative analytics (vs. other users, benchmarks)?
- Can we add analytics for collections/groups separately?
- Can we export user statistics?

### Known Concerns
- Streak calculation logic (timezone-dependent)
- Stats aggregation correctness
- Real-time vs. batch analytics strategy
- Cron job reliability and error handling
- Analytics data consistency

## Related Sections

- `BY_LAYER/API-Layer/` - Analytics API calls
- `BY_LAYER/Backend-Functions/` - Stats computation
- `BY_LAYER/Frontend-Screens/` - Analytics screens
- `BY_DOMAIN/Study-Session/` - Source of session data
- `BY_ARCHITECTURE/Data-Flow/` - How analytics data flows

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Analytics-Insights/FINDINGS.md` and document your review.
