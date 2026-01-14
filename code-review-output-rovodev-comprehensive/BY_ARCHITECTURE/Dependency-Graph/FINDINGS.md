[STATUS: review_done_needs_followup]

# Dependency-Graph Architecture Review

## Summary
Dependency graph is mostly clean but has some circular dependencies and tight coupling. Auth and store tightly coupled. Components depend on too many concerns.

---

## Critical Issues

### 1. Circular Dependencies in Store
**Severity:** MEDIUM
**Issue:**
- Store imports hooks that import store
- Collections depend on verses depend on progress
- Hard to test independently

**Impact:**
- Harder to maintain
- Harder to test
- Risk of circular initialization

**Suggested Fix:**
Break circular dependencies by extracting pure functions.

**Ticket:** Create task: "Refactor store to eliminate circular dependencies"

---

### 2. Auth and Store Tightly Coupled
**Severity:** MEDIUM
**Issue:**
- Auth context needed everywhere
- Store depends on auth context
- Hard to test without mocking auth

**Impact:**
- Tight coupling
- Hard to test
- Hard to swap implementations

**Suggested Fix:**
Decouple through dependency injection or context.

**Ticket:** Create task: "Decouple auth from store with dependency injection"

---

### 3. Components Depend on Too Many Concerns
**Severity:** MEDIUM
**Issue:**
- Components import store, hooks, API, analytics
- Too many dependencies
- Hard to test

**Impact:**
- Tight coupling
- Hard to test
- Large dependency trees

**Suggested Fix:**
Use container components to manage dependencies.

**Ticket:** Create task: "Reduce component dependencies with container pattern"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Refactor store to eliminate circular dependencies | MEDIUM | Architecture |
| Decouple auth from store with dependency injection | MEDIUM | Architecture |
| Reduce component dependencies with container pattern | MEDIUM | Architecture |
