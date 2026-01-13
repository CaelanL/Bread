# BY_DOMAIN/ - Feature/Capability Perspective

## Overview

Review the codebase through the lens of **user-facing features and business capabilities**. Each domain represents a major feature or functional area of the BibleMem app.

When reviewing by domain, ask:
- Does this feature work correctly?
- Is the code maintainable?
- Can we easily extend or modify this feature?
- Are there scale or performance issues?
- Is error handling comprehensive?
- Are there lazy patterns or tech debt?

## Domains in This Section

### [Authentication](./Authentication/_SECTION.md)
User login, registration, password recovery, session management, and auth token handling.

### [Library-Management](./Library-Management/_SECTION.md)
Collections, organizing verses, adding/removing verses, metadata management, collection operations.

### [Study-Session](./Study-Session/_SECTION.md)
The core learning loop: difficulty levels, recording attempts, progress tracking, session completion logic.

### [Analytics-Insights](./Analytics-Insights/_SECTION.md)
Streaks, practice stats, user engagement metrics, vault of the month, user insights display.

### [Settings](./Settings/_SECTION.md)
User preferences, color mode, Bible version selection, app configuration.

### [Bible-Data](./Bible-Data/_SECTION.md)
Bible text access, multiple Bible versions (ESV, NLT, KJV), verse fetching, caching, text normalization.

### [Data-Mutations](./Data-Mutations/_SECTION.md)
Operations that modify data: reordering verses, renaming collections, reorganizing libraries, bulk operations.

## Cross-Domain Concerns

These domains often interact:
- **Authentication** gates access to all other features
- **Library-Management** + **Study-Session** interact (selecting verses to study)
- **Study-Session** + **Analytics-Insights** (progress data flows to analytics)
- **Settings** affects all domains (color mode, Bible version selection)
- **Bible-Data** is consumed by all domains that display scripture

When reviewing one domain, consider its dependencies and impact on others.

## How to Navigate

1. Pick a domain that interests you
2. Read its `_SECTION.md` file for detailed scope
3. Review the listed source files
4. Create corresponding findings in your output directory
5. Mark status and move to next domain

## Next Steps

See individual domain `_SECTION.md` files for detailed guidance on each feature area.
