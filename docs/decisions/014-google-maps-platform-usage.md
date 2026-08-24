# ADR-014: Google Maps Platform usage & content policy (storage, attribution, keys, cost)

## Status

Accepted. Deliberately revises v1's "no embedded map — deep-link only" discovery
decision (`docs/agents/domain.md`, `docs/product/overview.md` deferred list) by
owner direction 2026-07-06 — see the Linear project **"Google Maps enrichment"**.
User photo *uploads* remain deferred (still no blob storage). Extends ADR-008
(Places intake), which stays in force.

## Context

ADR-008 brought Google Places in for **intake only** (autocomplete → name,
address, lat/lng, Place ID). The Google Maps enrichment work (Linear project,
owner-directed 2026-07-06) adds render-time Google surfaces: place photos, an
embedded map, and potentially hours/phone/website. Google Maps Platform (GMP)
content comes with binding license terms that constrain **what we may store,
how we must attribute, which keys may reach the browser, and what it costs**.
Every Maps/Places feature must follow one recorded policy instead of each PR
re-deriving (or violating) the rules.

The governing sources (as researched 2026-07-06):

- GMP Terms of Service §3.2.3 (license restrictions) —
  <https://cloud.google.com/maps-platform/terms>
- GMP Service Specific Terms §A.3 (Google-ID caching exception) and §B.14
  (Places rules, incl. §B.14.2 no-non-Google-maps and §B.14.3 30-day
  lat/lng caching) —
  <https://cloud.google.com/maps-platform/terms/maps-service-terms>
- Places API policies (attribution requirements) —
  <https://developers.google.com/maps/documentation/places/web-service/policies>

Key restrictions: no pre-fetching, indexing, storing, resharing, or rehosting
of GMP content (ToS §3.2.3(a)(i)); no copying/saving business names, addresses,
or user reviews (§3.2.3(a)(iii)); no caching except as expressly permitted
(§3.2.3(b)); no using Places content on a non-Google map (§3.2.3(e), §B.14.2).
The express carve-outs: **place IDs may be cached indefinitely** (§A.3), and
**lat/lng may be cached for up to 30 consecutive days** (§B.14.3).

- **GMP ToS §3.2.3(d)(iii) directory/listings restriction:** GMP ToS
  §3.2.3(d)(iii) prohibits using Maps Core Services "in a listings or
  directory service or to create or augment an advertising product";
  §3.2.3(d) allows products with "substantial, independent value and features
  beyond the Google products". **Accepted-risk rationale (owner-accepted):**
  aubreyslist's core content is its own community GF-safety evidence
  (ADR-007) — the community's attestations, incidents, and trust signals are
  the substantial, independent value; Google data is supplemental enrichment
  on top of that, never the substance of a listing. This is precisely why
  Google content must stay supplemental — never the substance of listings.

There is also money: post-March-2025 GMP pricing replaced the flat $200 credit
with **per-SKU monthly free caps** (Essentials 10k, Pro 5k, Enterprise 1k calls
per month; Place photo media $7.00 per 1,000 media requests beyond the SKU's
monthly free cap — exact tier per Google's current pricing table; Maps Embed
API free and unlimited; Maps JavaScript API 10k free map loads). The
free-tier-only cost posture (`docs/product/overview.md`) still applies.

## Decision

Record one GMP usage policy that every Maps/Places feature must follow:
**store only `place_id` (indefinitely) and lat/lng (30-day cache window);
fetch all other Google content at render time, server-side, never persisting
it**; always attribute; never mix Google data onto non-Google maps; keep the
server and browser API keys separate and separately restricted; and give every
Google-spending surface a graceful-degradation path mirroring ADR-008's intake
toggle so a quota/cost ceiling can never break the app.

## Consequences

### 1. Storage policy — what may touch the database

- **`place_id`: store indefinitely.** It is already our dedup key (ADR-008) and
  is expressly exempt from caching restrictions (§A.3 Google-ID caching
  exception).
- **lat/lng: cacheable for at most 30 consecutive days** (§B.14.3). Honest
  tension: we already persist lat/lng — along with names and addresses — as
  core listing data at intake (ADR-008, `db/schema.ts`), and §3.2.3(a)(iii)
  prohibits copying/saving business names and addresses sourced from Google.
  **Accepted risk posture (owner-accepted):** our listing content is primarily
  our own community safety data — the community's attestations, incidents, and
  trust signals attach to a restaurant identity we must be able to render
  without a live Google call; Google-sourced fields are supplemental
  convenience data on top. We record this tension rather than pretend it away;
  we do not expand it (see next bullet).
- **Never persist Google photos, ratings, hours, reviews, or phone numbers** —
  not to the DB, not to blob storage, not to committed JSON (seeds, fixtures).
  This is the "no pre-fetch, index, store, reshare, rehost" rule
  (§3.2.3(a)(i)), the no-copying rule (§3.2.3(a)(iii)), and the no-caching rule
  (§3.2.3(b)) applied to us. These fields are **render-time fetch only,
  server-side**, with a **short-TTL in-process cache (default 12h)**. That
  in-process TTL is documented as a pragmatic gray zone versus the strict
  no-caching clause — an owner-accepted risk, bounded by the quota caps below
  and by being in-memory only (evaporates on deploy/restart, never durable).

### 2. Attribution & display rules

- **`authorAttributions` must be displayed wherever a Google photo renders.**
  No cropping it out, no "photo by Google" shorthand.
- **Google attribution is required whenever Places data is displayed off-map**
  (e.g. hours or ratings shown in our own UI, not on a Google map) — per the
  Places policies doc.
- **Places data must never be rendered on a non-Google map** (§3.2.3(e),
  §B.14.2). If we ever consider Leaflet/OSM/Mapbox surfaces, Google-sourced
  content cannot appear on them; that would need a new ADR and a data-source
  change.

### 3. API key split — server vs. browser

- **Server key** — `GOOGLE_PLACES_API_KEY` (existing, ADR-008): restricted to
  **Places API (New)** only; used exclusively in server code; **never shipped
  client-side** (guarded today by the client-bundle guard and server-only
  module layout).
- **Browser key** — `VITE_GOOGLE_MAPS_BROWSER_KEY` (expected env name): a
  deliberately **public**, HTTP-referrer-restricted key, API-restricted to
  **Maps JavaScript API + Maps Embed API** only. Human-provisioned (AUB-217).
  Being referrer- and API-restricted is its entire security model — it must
  never be able to call Places.
- **Never cross-use the keys.** The server key must not appear in any client
  bundle or embed URL; the browser key must not be used for server-side Places
  calls.

### 4. Cost ceilings & graceful degradation

Post-March-2025 GMP pricing: per-SKU monthly free caps (Essentials 10k / Pro
5k / Enterprise 1k), photo media $7.00 per 1,000 media requests beyond the
SKU's monthly free cap (exact tier per Google's current pricing table), Maps
Embed API free/unlimited, Maps JS 10k free loads. Rules:

- **Every Google-spending surface must have a graceful-degradation path**
  mirroring ADR-008's intake toggle — a cost ceiling never breaks the app:
  - **Photo proxy kill-switch**: AppSetting `place_photos_enabled` — off means
    no photo media requests, UI falls back to the non-photo card/detail
    treatment.
  - **Map surfaces** fall back to the existing CSS placeholder /
    deep-link-only behavior whenever `VITE_GOOGLE_MAPS_BROWSER_KEY` is absent.
    The browser key is optional by design.
  - **Enterprise-tier fields** — hours / phone / website (AUB-218), plus
    `rating` / `userRatingCount` — share the 1k/month cap and stay behind a
    **separate, default-off** switch. AUB-218 covers hours/phone/website only;
    no rating surface is planned (AUB-104 canceled), so surfacing one would
    need its own gate.
- Prefer the free/unlimited **Maps Embed API** where it suffices before
  reaching for Maps JS SDK loads.

### 5. Supersession / scope notes

- v1's **"no embedded map — deep-link only"** decision is deliberately revised
  by owner direction 2026-07-06 (Linear project "Google Maps enrichment").
  `docs/agents/domain.md` and `docs/product/overview.md` are annotated
  accordingly.
- **User photo uploads remain deferred** — this ADR licenses rendering
  *Google's* photos at request time, not storing anyone's images. Still no
  blob storage.
