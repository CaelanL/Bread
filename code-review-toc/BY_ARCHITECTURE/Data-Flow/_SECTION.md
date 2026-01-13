# Data-Flow Architecture

## Purpose

Understand how data moves through the system: from user input → processing → storage → retrieval → display.

## Key Questions

- Where does user input enter the system?
- How is data transformed as it flows?
- Where is data stored (local vs server)?
- How does data get back from server to UI?
- Are there unnecessary data copies or transformations?
- Do all parts of the app see consistent data?

## Data Flow Paths to Trace

### 1. Adding a Verse to Collection
- User selects verse in add screen
- Data sent to API
- Stored in Supabase
- Synced to local storage
- Updated in Zustand store
- UI reflects change

### 2. Recording a Study Attempt
- User records audio
- Audio uploaded to Supabase
- Server processes recording (scoring)
- Result sent back to client
- Progress updated in store
- Analytics updated
- UI displays result

### 3. Fetching Verses from Bible
- App requests verses
- Cached locally?
- Fetches from API if not cached
- API routes to appropriate Bible adapter
- Text returned and cached
- Stored in store
- UI displays verse

## Review Focus

### Architecture Issues
- Is data normalized or duplicated?
- Are there data consistency issues?
- Is the data flow predictable and clear?
- Are there hidden data flows?
- Does data flow in the wrong direction (violate layering)?

### Scale Issues
- Does real-time data flow handle many users?
- Are data transformations efficient?
- Does broadcasting data updates cause perf issues?

### Future-Proofing
- Can we easily add new data types?
- Can we add real-time sync?
- Can we add data filtering/permissions?

## Related Sections

- `BY_LAYER/State-Management/` - Data storage
- `BY_LAYER/Data-Sync/` - Data synchronization
- `BY_LAYER/API-Layer/` - Data transmission
- All domains depend on data flow

## Next Steps

Create a `FINDINGS.md` file in your output directory.
