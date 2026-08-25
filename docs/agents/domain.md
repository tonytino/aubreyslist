# Domain Model — Listings, Trust, Roles

> Read this before building any listing, contribution, trust, discovery, or
> moderation feature. It defines the domain vocabulary and the rules every
> feature must honor. The product *why* is in `docs/product/overview.md`;
> architectural forks are in `docs/decisions/`.

---

## Core Entities

| Entity | What it is |
| --- | --- |
| **Listing** | A restaurant. Canonical identity is its **Google Place ID** (dedup key). Carries name, address, lat/lng, Maps deep-link, and **typed links** (AUB-202): at most one per kind (menu, gluten-free menu, website, reservations, online ordering) in the `listing_links` table. Kind taxonomy: `LINK_KINDS` in `app/listings/links.ts`. The legacy `menu_url` column is a render fallback only, shown when no `menu`-kind row exists; no product code writes it (E2E fixtures create legacy rows deliberately, to test the fallback). Typed `menu`-kind saves/removes CLEAR it — typed writes supersede the legacy column. |
| **Claim** | A community-attested statement about a listing, one per attribute in the fixed taxonomy below. Carries an aggregate of confirmations/disputes and a "last confirmed" timestamp. |
| **Attestation** | A single user's **confirm** or **dispute** on a claim. **One per user per claim** (changeable/retractable, not stackable). |
| **Incident** | A "got glutened here" report on a listing: required **date**, optional **severity**, optional **note**, attributed to a user. |
| **User** | A Google-authenticated account with a **role** (`admin` / `moderator` / `user`). |
| **AppSetting** | Admin-tunable runtime config (e.g. intake mode, staleness window). Backed by the feature-flag/settings system. |
| **Flag** | A user report that a listing / claim / incident is inappropriate, spam, or wrong. Feeds the moderation queue. |

---

## The GF Attribute Taxonomy (fixed / curated for v1)

The set is **curated, not user-extensible** in v1 — consistent, comparable,
filterable data. New attributes are added by us, never by contributors at
runtime.

1. **Celiac-safe** — the only community safety claim, surfaced most
   prominently. Every listing is assumed to have gluten-free options already,
   so the single question worth attesting is whether the kitchen takes
   cross-contamination seriously. Confirm ⇒ celiac-safe. Disputes count against
   the badge; once they tie or outnumber confirms it disappears entirely —
   never a lesser state. The enum key is `celiac_safe`; its label is
   "Celiac-safe".
2. **Dedicated / separate fryer** — yes / no / shared.
3. **Dedicated GF menu** — labeled GF items exist.
4. **Off-menu GF on request** — will make non-GF-labeled dishes GF when asked.
5. **GF substitutes available** — bread/buns, pizza crust, pasta, etc.

> When adding or renaming attributes, update this list **and** the filter UI
> **and** any seed data in the same change. The client-safe source of truth is
> `app/listings/taxonomy.ts` (`CLAIM_ATTRIBUTES`); the `claim_attribute` pgEnum
> derives from it.

### Deferred (post-v1)

Two attributes are deferred because they are ambiguous as a community
confirm/dispute, tracked in
[issue #175](https://github.com/tonytino/aubreyslist/issues/175):

- **Cross-contamination protocol** — too vague as a yes/no; needs a structured
  shape.
- **Staff knowledge & attitude** — not crisp enough to attest reliably.

Enum-value renames need a data-preserving enum-recreate migration; see
`db/migrations/0006_wide_sprite.sql` for the shape.

---

## Trust Model (see ADR-007 and ADR-016 for the decisions)

**Hybrid: a transparent summary layer over fully visible evidence.** The summary
is a roll-up of the raw evidence, never a secret formula.

For each claim, show **the distribution and recency**, e.g.
*"Dedicated fryer — 8 confirm / 1 dispute · last confirmed 3 weeks ago."* Below
the summary, the underlying evidence stays visible.

Rules every trust-related feature must honor:

- **Recency is weighted.** "Last confirmed" drives staleness; an old consensus
  is weaker than a fresh one.
- **Staleness window: 6 months** (admin-tunable via AppSetting). A claim not
  confirmed within the window gets a "may be stale" treatment — not hidden,
  flagged.
- **Recent incidents flag the summary.** A recent "got glutened" incident shows
  a prominent warning on the listing (e.g. "⚠️ recent incident reported 3 days
  ago") **regardless of** how many older confirmations exist. Never let old
  confirmations bury fresh harm.
- **A disputed headline claim shows nothing** (ADR-016). When disputes tie or
  outnumber confirms on the celiac claim, the listing renders no badge, no
  freshness cue, and no evidence counts at glance level (cards, map pins,
  detail hero, filters) — indistinguishable from an unattested listing. The
  confirm/dispute counts stay visible on the claim row, and incident signals
  are exempt. Copy shared by the two cases must state only what is true of
  both ("not confirmed celiac-safe"); "Not yet attested" is false on a
  contested claim and must never stand in for the no-verdict glance.
- **One vote per user per claim.** No ballot-stuffing. A user may change or
  retract their own attestation.
- **The summary must remain explainable.** Anything shown in the roll-up must be
  derivable from evidence the user can also see. No opaque scoring.

---

## Roles & Permissions (see ADR-010)

| Action | user | moderator | admin |
| --- | --- | --- | --- |
| Browse / search / view (no login) | ✅ (anon) | ✅ | ✅ |
| Add listing, attest, report incident | ✅ | ✅ | ✅ |
| Edit / retract **own** contributions | ✅ | ✅ | ✅ |
| Flag content | ✅ | ✅ | ✅ |
| View moderation queue, hide/remove **any** content | — | ✅ | ✅ |
| Promote / demote moderators | — | — | ✅ |
| Manage app settings (intake mode, staleness) | — | — | ✅ |

- **Read is open / write is gated** — anonymous users browse; any write requires
  Google login.
- **Listing links are wiki-editable** (AUB-202): the "own contributions" rule
  does NOT apply to a listing's typed links — ANY signed-in user may add, edit,
  or remove any listing's links (deliberate product decision, enforced without
  ownership checks server-side). Abuse is handled like other content: rate
  limits plus moderation, with `created_by` kept as provenance.
- **Admins grant the moderator role** to any Google account at any time.
- **Light rate limiting** applies to writes as an anti-abuse guardrail; there is
  **no reputation gating** in v1.

---

## Listing Intake (see ADR-008)

- **Default:** Google Places autocomplete → structured data + **Place ID**
  (automatic dedup, powers the Maps deep-link).
- **Fallback:** manual entry form, always present.
- **Admin toggle:** an AppSetting flips active intake mode (Places ↔ manual) so
  hitting the Places free limit degrades gracefully instead of breaking adds.
- **Dedup:** two users adding the same place resolve to the same Place ID →
  same listing. Manual entries need a dedup safeguard (match on name+address).

---

## Discovery (v1)

List-first, with embedded map surfaces and Google place photos in scope
(owner-directed, Linear project "Google Maps enrichment") — governed by the GMP
usage & content policy in **ADR-014** (storage limits, attribution, key split,
cost/degradation rules). Deep-linking to Google Maps is the fallback whenever
the browser Maps key is absent. Supports: **text search** (name/cuisine),
**filters** by the taxonomy above (the killer feature — "celiac-safe + dedicated
fryer"), **sort** by trust/recency or alphabetical, and **"near me"** distance
sort using listing lat/lng + browser geolocation. "Near me" is the default
order: it anchors on the browser reading when granted, else the coarse
request location, and degrades to "recently confirmed" with neither. The
visitor's coordinates never enter the URL.
