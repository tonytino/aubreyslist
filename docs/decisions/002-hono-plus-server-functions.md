# ADR-002: Dual-Layer API with Hono + Server Functions

## Status

Accepted

## Context

Full-stack apps need server-side logic for two distinct purposes: fetching data tightly coupled to a specific UI route, and exposing endpoints consumed by external clients, webhooks, or mobile apps. Collapsing both into one pattern creates either leaky abstractions (server functions used as a public API) or unnecessary boilerplate (Hono routes for simple loader data).

## Decision

We use two layers. TanStack server functions (`createServerFn`) handle UI-coupled data -- route loaders, form actions, and any server logic that exists solely to serve a specific component. Hono v4 handles portable API endpoints -- anything that needs to be callable outside the frontend, versioned independently, or tested without rendering a component. The two layers share the same database and validation logic but are invoked differently.

## Consequences

- When adding data fetching for a route, use a server function. See `docs/agents/api.md` for the pattern.
- When adding an endpoint for external consumption (webhooks, third-party integrations, mobile clients), use a Hono route.
- Do not call Hono routes from the frontend with raw `fetch`. Use the typed RPC client.
- Do not expose server functions as a public API. They are coupled to the frontend and can change shape without notice.
- Both layers import from the same `db/` module for database access and use Zod for input validation.
