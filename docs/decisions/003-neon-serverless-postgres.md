# ADR-003: Neon Serverless Postgres over Supabase/PlanetScale

## Status

Accepted

## Context

The template needs a database that works well with serverless deployments, has a generous free tier for prototyping, and uses standard Postgres so that knowledge and tooling transfer across projects. Supabase bundles more than needed (auth, storage, realtime) and encourages vendor lock-in. PlanetScale uses MySQL and has removed its free tier.

## Decision

We chose Neon because it provides serverless Postgres with branching, a permanent free tier, and a connection pooler that works in edge runtimes. It is standard Postgres -- no proprietary query language, no bundled auth layer, no platform-specific client. Drizzle ORM provides the type-safe query layer on top.

## Consequences

- Database schema is defined in `db/schema.ts` using Drizzle's schema builder. Do not write raw DDL.
- Migrations are generated with `pnpm db:generate` and applied with `pnpm db:migrate`. Do not edit files in `db/migrations/` by hand.
- The connection string comes from the `DATABASE_URL` env var, accessed through `app/env.ts`.
- All queries go through the Drizzle client. Do not use Neon's HTTP API or serverless driver directly unless Drizzle cannot express the query.
- Neon's branching feature can be used for preview environments but is not wired up by default in this template.
- If migrating away from Neon, any standard Postgres host works -- swap the connection string and pooler config.
