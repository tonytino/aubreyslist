# ADR-008: Google Places intake with admin-toggled manual fallback

## Status

Accepted

## Context

When a user adds a restaurant we want **structured, canonical, deduplicated**
data. Free-typed entries produce messy, inconsistent, hard-to-dedupe records and
more moderation burden. Google Places autocomplete gives us an official name,
address, lat/lng, and a **Place ID** — a stable unique key that makes duplicate
prevention essentially automatic and powers the Google Maps deep-link. The
tradeoff: Places is a **paid API** with a recurring free allowance. We must not
let a cost ceiling break the ability to add listings, nor absorb a surprise bill
with no mitigation.

## Decision

Use **Google Places autocomplete as the default intake**, with a **manual entry
form as an always-present fallback**, and an **admin-controlled toggle**
(AppSetting) that flips the active intake mode (Places ↔ manual). This is the
first consumer of the reusable app-settings / feature-flag system.

## Consequences

- Default add-listing flow uses Places autocomplete; the resolved **Place ID is
  the dedup key** (same place → same listing).
- The **manual form must always work** as a code path — it is the safety net,
  not dead code. Manual entries need a dedup safeguard (name + address match).
- An **admin can switch intake to manual** from the admin panel if Places nears
  its free limit — graceful degradation, never a hard break.
- The **Places API key is human-provisioned** (`safe:human`, Bucket 1) via
  `app/env.ts` / Vercel env; keep `.env.example` in sync. Server-side calls
  only — never expose the key client-side.
- Build the **app-settings/feature-flag system** as reusable infrastructure;
  intake mode and the staleness window are its first two settings.
