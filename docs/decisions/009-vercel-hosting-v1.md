# ADR-009: Vercel hosting for v1, Cloudflare as a post-launch exercise

## Status

Accepted

## Context

TanStack Start (on Vinxi/Nitro) can deploy to Vercel, Netlify, or Cloudflare via
Nitro presets, and our database (Neon via the `drizzle-orm/neon-http` driver) is
edge-compatible, so all three are technically viable. ADR-001 requires deploy
targets to be compatible with Vinxi's output. For a trust-critical pilot, the
priority is getting a working app in front of real users with minimal infra
yak-shaving; Cloudflare Workers offers a good learning opportunity but more
runtime friction up front. The cost posture is free-tiers-only for v1.

## Decision

Ship **v1 on Vercel** using a Nitro/Vercel preset (lowest-friction first-class
TanStack Start support, free hobby tier sufficient at pilot scale). Keep the app
**deployment-portable** so a **Cloudflare port becomes a deliberate post-launch
issue** — a better way to learn Cloudflare against a real app than fighting it
during initial build.

## Consequences

- Configure the **Vercel/Nitro preset**; do not hardcode platform assumptions
  that would block a future preset swap.
- The **Vercel project is human-provisioned** (`safe:human`, Bucket 1); env/
  secrets set there, mirrored in `.env.example`.
- Launch on a **free Vercel subdomain**; attach a custom domain later.
- **Free tiers only** for v1 (Vercel hobby + Neon free + Places free allowance);
  paid spend waits for ad revenue.
- The **Cloudflare port lives in the post-launch backlog**, not v1 scope.
