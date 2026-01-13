# Database-Schema Layer

## Purpose

SQL schema design, table structures, migrations, relationships, and indexes. The foundation of all data persistence.

## Responsibilities

- Table definitions and columns
- Primary/foreign keys and relationships
- Indexes for performance
- Constraints for data integrity
- Migrations for schema changes
- Data types and column constraints
- Row-level security (RLS) policies

## Source Files to Review

### Migrations
- `supabase/migrations/001_initial.sql` - Initial schema
- `supabase/migrations/002_user_data.sql` - User data tables
- `supabase/migrations/003_chapter_cache.sql` - Bible chapter cache
- `supabase/migrations/004_verse_level_cache.sql` - Bible verse cache
- `supabase/migrations/005_user_verses_no_text.sql` - User verses
- `supabase/migrations/006_verse_collections_junction.sql` - Collections/verses relationship
- `supabase/migrations/007_verse_of_month.sql` - VotM feature
- `supabase/migrations/008_votm_image.sql` - VotM images
- `supabase/migrations/009_session_attempts.sql` - Session tracking
- `supabase/migrations/010_add_word_count.sql` - Word count tracking
- `supabase/migrations/011_user_stats_cron.sql` - Stats aggregation

## Review Focus

### Scale Issues
- Are indexes present on frequently-queried columns?
- Are there missing indexes causing slow queries?
- Does the schema support 1M+ users efficiently?
- Are there unused indexes that slow writes?
- Is the schema normalized appropriately? (no redundant data?)

### Code Quality
- Are data types appropriate? (TEXT vs VARCHAR, INT vs BIGINT?)
- Are constraints in place to prevent invalid data?
- Are nullable columns justified?
- Are migrations reversible/idempotent?
- Are there data integrity issues (orphaned records)?
- Is RLS properly configured for security?

### Future-Proofing
- Can we easily add new columns to tables?
- Can we add new relationships without major refactoring?
- Can we archive old data without schema changes?
- Can we add multi-tenancy support?
- Can we replicate/shard the database?

### Known Concerns
- Schema normalization (data duplication?)
- Index effectiveness
- RLS configuration
- Migration reversibility
- Data integrity constraints

## Related Sections

- `BY_LAYER/Storage/` - How storage accesses schema
- `BY_LAYER/Backend-Functions/` - Queries against schema
- `BY_ARCHITECTURE/Data-Flow/` - Data model overview
- `BY_ARCHITECTURE/Performance/` - Query performance

## Next Steps

Create a `FINDINGS.md` file in your output directory.
