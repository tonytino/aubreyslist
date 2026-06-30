# Domain Model — Listings, Trust, Roles

> Read this before building any listing, contribution, trust, discovery, or
> moderation feature. It defines the domain vocabulary and the rules every
> feature must honor. The product *why* is in `docs/product/overview.md`;
> architectural forks are in `docs/decisions/`.

---

## Core Entities

| Entity | What it is |
| --- | --- |
| **Listing** | A restaurant. Canonical identity is its **Google Place ID** (dedup key). Carries name, address, lat/lng, Maps deep-link, optional menu-link URL. |
| **Claim** | A community-attested statement about a listing, one per attribute in the fixed taxonomy below. Carries an aggregate of confirmations/disputes and a "last confirmed" timestamp. |
| **Attestation** | A single user's **confirm** or **dispute** on a claim. **One per user per claim** (changeable/retractable, not stackable). |
| **Incident** | A "got glutened here" report on a listing: required **date**, optional **severity**, optional **note**, attributed to a user. |
| **User** | A Google-authenticated account with a **role** (`admin` / `moderator` / `user`). |
| **AppSetting** | Admin-tunable runtime config (e.g. intake mode, staleness window). Backed by the feature-flag/settings system. |
| **Flag** | A user report that a listing / claim / incident is inappropriate, spam, or wrong. Feeds the moderation queue. |

---

## The GF Attribute Taxonomy (fixed / curated for v1)

The set is **curated, not user-extensible** in v1 — consistent, comparable,
filterable data. New attributes are added by us over time, never by contributors
at runtime.

1. **Celiac-safe** — the headline distinction, surfaced most prominently. Does
   the restaurant take cross-contamination seriously (confirm ⇒ celiac-safe), or
   merely offer GF-ish options (dispute ⇒ gluten-friendly)? Every listing is
   assumed gluten-free-friendly already, so the useful community question is just
   "is it celiac-safe?" The enum key is still `celiac_safe_vs_gluten_friendly`
   (rename deferred — see below); only its label is "Celiac-safe".
2. **Dedicated / separate fryer** — yes / no / shared.
3. **Dedicated GF menu** — labeled GF items exist.
4. **Off-menu GF on request** — will make non-GF-labeled dishes GF when asked.
5. **GF substitutes available** — bread/buns, pizza crust, pasta, etc.

> When adding or renaming attributes, update this list **and** the filter UI
> **and** any seed data in the same change. The taxonomy is referenced in many
> places; keep it singular and authoritative. The client-safe source of truth is
> `app/listings/taxonomy.ts` (`CLAIM_ATTRIBUTES`); the `claim_attribute` pgEnum
> derives from it.

### Deferred (post-v1)

Two attributes were **purged before v1** (issue #175) because they were ambiguous
as a community confirm/dispute and need a clearer design before they earn a vote:

- **Cross-contamination protocol** — "confirm what, exactly?" Too vague as a
  yes/no; needs a structured shape (e.g. specific practices) rather than one vote.
- **Staff knowledge & attitude** — close, but not crisp enough to attest reliably.

They are tracked for re-introduction in [issue #175](https://github.com/tonytino/aubreyslist/issues/175).
Also deferred: renaming the headline enum key `celiac_safe_vs_gluten_friendly →
celiac_safe` (a cosmetic cleanup that would force an enum type-recreate
migration).

---

## Trust Model (see ADR-007 for the decision)

**Hybrid: a transparent summary layer over fully visible evidence.** The summary
is a *roll-up of the raw evidence*, never a secret formula.

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
- **Admins grant the moderator role** to any Google account at any time (starts
  with the owner + trusted people).
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

List-first (no embedded map — deep-link to Google Maps). Supports: **text
search** (name/cuisine), **filters** by the taxonomy above (the killer
feature — "celiac-safe + dedicated fryer"), **sort** by trust/recency or
alphabetical, and **"near me"** distance sort using listing lat/lng +
browser geolocation.
