# ADR-005: File-Based Routing with TanStack Router

## Status

Accepted

## Context

Routing configuration can either be defined explicitly in code or derived from the filesystem. Explicit configuration gives full control but requires manual bookkeeping that agents frequently get wrong (forgetting to register routes, mismatching paths and components). File-based routing eliminates this class of errors by generating the route tree from the directory structure.

## Decision

We use TanStack Router's file-based routing. Routes are defined by creating files in `app/routes/` following a naming convention. The route tree is auto-generated into `app/routeTree.gen.ts` on each dev server start and build. This gives us type-safe route references, automatic code splitting, and zero manual route registration.

## Consequences

- To add a new route, create a file in `app/routes/`. The file name determines the URL path. See `docs/agents/routing.md` for naming conventions.
- Never edit `app/routeTree.gen.ts` manually. It is auto-generated and overwritten on every build.
- Route files export a `Route` object created with `createFileRoute`. Do not use `createRoute` or manual route trees.
- Type-safe navigation is available through the generated route tree. Use `<Link to="/path">` with the autocompleted path, not raw strings in `<a>` tags.
- Route parameters, search params, and loaders are all type-checked. If a route expects params, TypeScript will enforce them at every call site.
- Reorganizing routes means moving files, not updating a config object. The route tree regenerates automatically.
