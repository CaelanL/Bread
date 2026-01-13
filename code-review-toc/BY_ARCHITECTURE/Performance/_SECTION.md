# Performance Architecture

## Purpose

Identify performance bottlenecks, optimization opportunities, and ensure the system performs well at scale.

## Key Questions

- Where are the performance bottlenecks?
- What takes too long to load?
- What consumes too much memory?
- What causes unnecessary re-renders?
- Are API calls optimized?
- Are database queries efficient?

## Performance Areas

### 1. App Startup
- How long does app take to launch?
- Is auth check blocking?
- Is store hydration blocking?
- Is data migration slow?

### 2. Screen Transitions
- How fast do screens load?
- Are transitions smooth?
- Do list renders cause jank?

### 3. API Performance
- Are API calls fast enough?
- Are there unnecessary requests?
- Are requests batched?

### 4. Local Operations
- Are local computations slow?
- Is Zustand store slow?
- Is AsyncStorage slow?

### 5. Memory Usage
- Does the app leak memory?
- Are large objects kept in memory?
- Are caches too large?

## Review Focus

### Architecture Issues
- Are there obvious bottlenecks?
- Are heavy operations blocking?
- Are there opportunities for parallelization?

### Implementation Issues
- Are components rendering unnecessarily?
- Are selectors optimized?
- Are queries optimized?

## Related Sections

- `BY_LAYER/State-Management/` - Store performance
- `BY_LAYER/Components/` - Component rendering
- `BY_LAYER/API-Layer/` - API performance
- `BY_LAYER/Database-Schema/` - Query performance
- `BY_ARCHITECTURE/Caching-Strategy/` - Caching performance

## Next Steps

Create a `FINDINGS.md` file in your output directory.
