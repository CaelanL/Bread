# Dependency-Graph Architecture

## Purpose

Understand how modules depend on each other. Identify circular dependencies, tight coupling, and refactoring risks.

## Key Questions

- Are there circular dependencies?
- Is the dependency graph a DAG (directed acyclic graph)?
- Are there modules with too many dependencies (high fan-in)?
- Are there modules depending on too many things (high fan-out)?
- Can we remove or refactor a module without breaking others?
- What's the impact of changing a specific module?

## Dependency Analysis Areas

### 1. Import Structure
- What imports what?
- Are imports going downward (layering)?
- Are there upward imports (violating layering)?

### 2. Circular Dependencies
- Do modules import each other (direct or indirect)?
- Can we break circular deps?

### 3. Coupling
- How tightly coupled are modules?
- Could we swap a module for another implementation?
- Can we mock/test modules in isolation?

### 4. Critical Paths
- What modules are critical (many things depend on them)?
- What happens if critical modules fail?
- Can we make critical modules more resilient?

## Key Modules to Analyze

- `lib/store/` - Likely high fan-in (many things depend on it)
- `lib/api/` - Likely high fan-out (depends on many services)
- `lib/auth/` - Critical (gates access)
- `lib/sync/` - Complex (depends on store, API, storage)

## Review Focus

### Architecture Issues
- Are there problematic circular dependencies?
- Is modularity clear?
- Are there god objects (do too much)?
- Can we refactor without cascading changes?

### Refactoring Risks
- What's at risk if we change X?
- How many places need updates?

## Related Sections

- `BY_ARCHITECTURE/Extensibility/` - Modularity enables extensibility
- All layers - Dependency structure spans layers

## Next Steps

Create a `FINDINGS.md` file in your output directory.
