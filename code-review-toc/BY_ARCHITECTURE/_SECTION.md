# BY_ARCHITECTURE/ - Cross-Cutting Concerns

## Overview

Review the codebase through the lens of **system-wide architectural patterns and non-functional requirements**. These concerns cut across layers and domains.

When reviewing by architecture, ask:
- How does data flow through the entire system?
- Are there single points of failure?
- How does the system scale?
- Is the system resilient to failures?
- Are there security gaps?
- Is the system extensible for future features?

## Concerns in This Section

### [Auth-Flow](./Auth-Flow/_SECTION.md)
End-to-end authentication and session management architecture.

### [Data-Flow](./Data-Flow/_SECTION.md)
How data moves through the system from user input to display and back to storage.

### [Caching-Strategy](./Caching-Strategy/_SECTION.md)
Caching at all levels: API, database, local, and component level.

### [Error-Handling](./Error-Handling/_SECTION.md)
How errors are handled, reported, and recovered from across the system.

### [Performance](./Performance/_SECTION.md)
Optimization opportunities, bottlenecks, and performance considerations.

### [Extensibility](./Extensibility/_SECTION.md)
How easily can we add new features without major refactoring?

### [Type-Safety](./Type-Safety/_SECTION.md)
Type coverage, `any` elimination, and type safety across the codebase.

### [API-Contracts](./API-Contracts/_SECTION.md)
Edge function endpoints, request/response contracts, and versioning strategy.

### [Dependency-Graph](./Dependency-Graph/_SECTION.md)
Module dependencies, circular dependencies, coupling, and refactoring risks.

## Cross-Architecture Patterns

These concerns often interact:
- **Auth-Flow** is used by all other concerns (gated access)
- **Data-Flow** involves **Caching-Strategy** and **Error-Handling**
- **Performance** affects all concerns
- **Type-Safety** reduces **Error-Handling** burden
- **Extensibility** depends on good **Dependency-Graph**

## How to Navigate

1. Pick an architectural concern
2. Read its `_SECTION.md` file for detailed scope
3. Investigate how that concern is handled across the codebase
4. Create corresponding findings in your output directory
5. Mark status and move to next concern

## Next Steps

See individual concern `_SECTION.md` files for detailed guidance on each architectural aspect.
