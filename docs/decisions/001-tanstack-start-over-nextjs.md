# ADR-001: TanStack Start over Next.js

## Status

Accepted

## Context

The template needs a full-stack React framework that supports SSR, server functions, and type-safe routing. Next.js is the dominant option, but its conventions (App Router, React Server Components, caching layers) add complexity that works against agentic engineering. Agents perform better with explicit data flow and fewer hidden behaviors.

## Decision

We chose TanStack Start v1 (built on Vinxi) because it provides full-stack SSR with fully explicit data flow. Server functions are plain async functions with clear call sites. Routing is type-safe and code-generated. There are no implicit caching layers, no magic `"use client"` boundaries, and no framework-specific fetch wrappers. The mental model is simpler: routes define loaders, loaders call server functions, components consume loader data via TanStack Query.

## Consequences

- All routing goes through TanStack Router. Do not introduce `react-router` or any other routing solution.
- Server-side data fetching uses TanStack server functions (via `createServerFn`), not React Server Components or Next.js-style `getServerSideProps`.
- The build system is Vinxi (not Vite directly, not Turbopack). Build config lives in `app.config.ts`.
- Deployment targets must be compatible with Vinxi's output. Check Vinxi docs before assuming a deployment platform works.
- If you see patterns from Next.js tutorials (e.g., `page.tsx` with default exports, `layout.tsx`, `loading.tsx`), they do not apply here.
