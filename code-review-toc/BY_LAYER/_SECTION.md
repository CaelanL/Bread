# BY_LAYER/ - Technical Layer Perspective

## Overview

Review the codebase through the lens of **architectural layers and technical concerns**. Each layer represents a horizontal slice of the application responsible for specific technical responsibilities.

When reviewing by layer, ask:
- Is this layer's responsibility clear and focused?
- Are dependencies flowing in the right direction?
- Is this layer testable and maintainable?
- Are there scale or performance issues at this layer?
- Could this layer be replaced without breaking others?
- Is this layer type-safe and error-safe?

## Layers in This Section

### [Frontend-Screens](./Frontend-Screens/_SECTION.md)
Route screens, page-level components, navigation, and UI that users see.

### [Components](./Components/_SECTION.md)
Reusable UI components (buttons, cards, modals, headers, etc.) used by screens.

### [State-Management](./State-Management/_SECTION.md)
Zustand store, global state management, data hydration, and state mutations.

### [API-Layer](./API-Layer/_SECTION.md)
Client-side API calls to Supabase, request/response handling, and client initialization.

### [Backend-Functions](./Backend-Functions/_SECTION.md)
Edge functions running on Supabase, business logic, routing, and processing.

### [Data-Sync](./Data-Sync/_SECTION.md)
Local ↔ Server synchronization, conflict resolution, migration, and data consistency.

### [Storage](./Storage/_SECTION.md)
AsyncStorage for local persistence, database access patterns, and storage abstractions.

### [Database-Schema](./Database-Schema/_SECTION.md)
SQL table definitions, migrations, relationships, indexes, and data model design.

### [Type-System](./Type-System/_SECTION.md)
TypeScript types, interfaces, type safety, and type coverage across all layers.

## Layer Dependencies

Ideally, dependencies flow downward:

```
Frontend-Screens
    ↓
Components + State-Management
    ↓
API-Layer + Data-Sync
    ↓
Storage
    ↓
Database-Schema
```

When reviewing, watch for layers that depend on layers above them (violates layering principle).

## Cross-Layer Concerns

These layers often interact:
- **Frontend-Screens** use **Components** and **State-Management**
- **State-Management** calls **API-Layer** for data
- **API-Layer** calls **Backend-Functions** on server
- **Backend-Functions** access **Database-Schema**
- **Data-Sync** bridges **State-Management** and **Storage**
- **Type-System** affects all layers

## How to Navigate

1. Pick a layer that interests you
2. Read its `_SECTION.md` file for detailed scope
3. Review the listed source files
4. Create corresponding findings in your output directory
5. Mark status and move to next layer

## Next Steps

See individual layer `_SECTION.md` files for detailed guidance on each technical layer.
