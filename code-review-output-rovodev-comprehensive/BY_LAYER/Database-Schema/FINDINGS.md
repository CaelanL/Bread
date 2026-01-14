[STATUS: review_done_needs_followup]

# Database-Schema Layer Review

## Summary
The database schema is well-designed with proper normalization, soft-deletes, and junction tables. However, there are critical concerns around missing indexes, lack of constraints, no audit tables, and insufficient error handling for schema evolution.

---

## Critical Issues

### 1. Missing Indexes on Common Queries
**File:** `supabase/migrations/` (all migrations)
**Severity:** CRITICAL
**Issue:**
```sql
-- These queries run without indexes:
SELECT * FROM user_verses WHERE user_id = ? AND deleted_at IS NULL;
SELECT * FROM verse_collections WHERE collection_id = ? AND deleted_at IS NULL;
SELECT * FROM session_attempts WHERE user_id = ? AND difficulty = ? AND accuracy >= 90;
```
- Full table scans on millions of records
- Queries timeout at scale
- Database CPU maxed

**Impact:**
- App unusable with 10k+ users
- Queries timeout
- User experience degraded

**Suggested Fix:**
```sql
-- Add strategic indexes
CREATE INDEX idx_user_verses_user_id_deleted 
ON user_verses(user_id, deleted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_verse_collections_collection_id_deleted
ON verse_collections(collection_id, deleted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_session_attempts_user_difficulty_accuracy
ON session_attempts(user_id, difficulty, accuracy DESC)
WHERE accuracy >= 90;

CREATE INDEX idx_session_attempts_created_at_user
ON session_attempts(user_id, created_at DESC);

-- Analyze to update statistics
ANALYZE user_verses;
ANALYZE verse_collections;
ANALYZE session_attempts;
```

**Ticket:** Create task: "Add missing database indexes for common queries"

---

### 2. No Foreign Key Constraints
**File:** All migration files
**Severity:** CRITICAL
**Issue:**
- No FK constraints between user_verses and user_collections
- No FK constraints between user_verses and session_attempts
- Database allows orphaned records
- Data integrity not enforced

**Impact:**
- Orphaned data possible
- Inconsistent state
- Data corruption possible
- Hard to debug

**Suggested Fix:**
```sql
-- Add constraints
ALTER TABLE user_verses
ADD CONSTRAINT fk_user_verses_user
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE user_collections
ADD CONSTRAINT fk_user_collections_user
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE verse_collections
ADD CONSTRAINT fk_verse_collections_verse
FOREIGN KEY (verse_id) REFERENCES user_verses(id) ON DELETE CASCADE;

ALTER TABLE verse_collections
ADD CONSTRAINT fk_verse_collections_collection
FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE;

ALTER TABLE session_attempts
ADD CONSTRAINT fk_session_attempts_user
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE session_attempts
ADD CONSTRAINT fk_session_attempts_verse
FOREIGN KEY (verse_id) REFERENCES user_verses(id) ON DELETE CASCADE;

ALTER TABLE user_stats
ADD CONSTRAINT fk_user_stats_user
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

**Ticket:** Create task: "Add foreign key constraints to enforce referential integrity"

---

### 3. No Audit Logging Table
**File:** All migration files
**Severity:** HIGH
**Issue:**
- No record of who changed what when
- Can't track data changes
- No compliance/audit trail
- Can't debug who deleted data

**Impact:**
- No accountability
- Hard to debug issues
- GDPR compliance issues (no access log)
- Can't track who caused data corruption

**Suggested Fix:**
```sql
-- Create audit log table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'delete'
  entity TEXT NOT NULL, -- 'verse', 'collection', etc
  entity_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  
  INDEX idx_audit_user_created (user_id, created_at DESC),
  INDEX idx_audit_entity (entity, entity_id, created_at DESC)
);

-- Create trigger for auto-logging
CREATE OR REPLACE FUNCTION log_verse_changes() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, entity, entity_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    'verse',
    COALESCE(NEW.id, OLD.id),
    to_jsonb(OLD),
    to_jsonb(NEW)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER verse_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON user_verses
FOR EACH ROW EXECUTE FUNCTION log_verse_changes();
```

**Ticket:** Create task: "Add audit logging table and triggers"

---

## Code Quality Issues

### 1. No Check Constraints on Value Ranges
**File:** All migration files
**Severity:** MEDIUM
**Issue:**
- No constraint on accuracy values (0-100)
- No constraint on difficulty levels
- Database accepts invalid data

**Impact:**
- Invalid data in database
- Calculations break

**Suggested Fix:**
```sql
-- Add check constraints
ALTER TABLE session_attempts
ADD CONSTRAINT check_accuracy_range CHECK (accuracy >= 0 AND accuracy <= 100);

ALTER TABLE session_attempts
ADD CONSTRAINT check_difficulty_valid CHECK (
  difficulty IN ('easy', 'medium', 'hard')
);

ALTER TABLE user_verses
ADD CONSTRAINT check_chunk_size_positive CHECK (chunk_size > 0);
```

**Ticket:** Create task: "Add check constraints for valid value ranges"

---

### 2. No Unique Constraints on Client IDs
**File:** All tables with client_id
**Severity:** MEDIUM
**Issue:**
```sql
-- user_collections and user_verses both have client_id
-- But no uniqueness constraint
-- User could sync and create duplicates
```
- Duplicates possible per user
- Data inconsistency

**Impact:**
- Duplicate collections/verses
- Confusing data state

**Suggested Fix:**
```sql
-- Add unique constraints
ALTER TABLE user_collections
ADD CONSTRAINT unique_user_collection_client 
UNIQUE(user_id, client_id);

ALTER TABLE user_verses
ADD CONSTRAINT unique_user_verse_client
UNIQUE(user_id, client_id);
```

**Ticket:** Create task: "Add unique constraints on client IDs per user"

---

### 3. No Schema Versioning Table
**File:** All migration files
**Severity:** MEDIUM
**Issue:**
- No tracking of applied migrations
- No way to know current schema version
- No rollback mechanism
- Can't debug which migration failed

**Impact:**
- Hard to manage schema evolution
- Can't track upgrade failures
- Difficult debugging

**Suggested Fix:**
```sql
-- Create schema version tracking
CREATE TABLE schema_migrations (
  version INT PRIMARY KEY,
  description TEXT NOT NULL,
  installed_on TIMESTAMP DEFAULT now(),
  execution_time INT, -- milliseconds
  status TEXT DEFAULT 'applied' -- 'applied', 'pending', 'failed'
);

-- Track each migration
INSERT INTO schema_migrations (version, description, execution_time, status)
VALUES (1, 'Initial schema', 125, 'applied');
```

**Ticket:** Create task: "Add schema migration tracking table"

---

## Performance Issues

### 1. No Partitioning for Large Tables
**File:** session_attempts table
**Severity:** MEDIUM
**Issue:**
- session_attempts table grows unbounded
- With millions of records, table scans slow
- No partitioning by time

**Impact:**
- Slow queries on large tables
- High memory usage
- Performance degradation over time

**Suggested Fix:**
```sql
-- Partition session_attempts by month
CREATE TABLE session_attempts_2026_01 PARTITION OF session_attempts
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE session_attempts_2026_02 PARTITION OF session_attempts
FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Automatically archive old data
-- Query recent data from small partition
```

**Ticket:** Create task: "Add time-based partitioning for session_attempts table"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add missing database indexes for common queries | CRITICAL | Performance |
| Add foreign key constraints to enforce referential integrity | CRITICAL | Data Integrity |
| Add audit logging table and triggers | HIGH | Compliance |
| Add check constraints for valid value ranges | MEDIUM | Quality |
| Add unique constraints on client IDs per user | MEDIUM | Quality |
| Add schema migration tracking table | MEDIUM | Maintainability |
| Add time-based partitioning for session_attempts table | MEDIUM | Performance |

---

## Next Review Section
→ Continue with: `BY_LAYER/Type-System`
