# ADR-006: Google OAuth as the sole auth provider (v1)

## Status

Accepted

## Context

Every contribution (adding listings, attesting claims, reporting incidents) must
be attributable for trust and moderation to work — write access is gated behind
login while read access stays open. We needed an auth approach for v1 that
minimizes implementation surface and friction while tying contributions to a
real identity. Supporting multiple providers or rolling our own email/password
flow adds account-recovery, verification, and security burden we don't want
during a single-metro pilot.

## Decision

Use **Google OAuth as the only sign-in method for v1**. Google accounts cover
the vast majority of the target audience, give us a verified identity with no
password storage, and keep the auth surface small. Additional providers are not
ruled out later but are out of scope for v1.

## Consequences

- The sign-in UI offers **only "Continue with Google."** Do not add
  email/password or other providers without a new ADR.
- The Google OAuth **client ID/secret are human-provisioned** (`safe:human`,
  Bucket 1) and injected via `app/env.ts` / Vercel env — never hardcoded, never
  committed. Keep `.env.example` in sync.
- Browsing/searching/viewing requires **no** login. Only writes require it. Auth
  guards enforce this boundary server-side, not just in the UI.
- Identity from Google seeds the `user` record; role defaults to `user` (see
  ADR-010).
