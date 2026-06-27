# Aubrey's List — Product Overview

> Agent-facing source of truth for **what** we're building and **why**. Read this
> before working any feature issue. Architectural forks are recorded as ADRs in
> `docs/decisions/`; the domain model (taxonomy, trust mechanics) lives in
> `docs/agents/domain.md`. This document is the canonical decision record for v1.

---

## The Problem

People with a gluten-free medical need (allergy / celiac-adjacent) have **no
reliable, rich source of truth** for how safe a given restaurant actually is.
The questions that matter are not answerable from Google Maps or generic
reviews:

- Do they use a **dedicated fryer**, or share oil with breaded food?
- Will they make an off-menu dish gluten-free **on request**?
- Does the staff **actually understand** cross-contamination, or just nod?
- Is the place **celiac-safe**, or merely "gluten-friendly" (the trap that
  causes real harm)?

There's no API to scrape this from, and generic reviews bury it. The
information is **inherently community-knowledge**, and it **decays** — a place
that was safe last year may have changed its fryer, menu, or staff.

## The Mission

A community-driven directory where this information is **contributed, attested,
dated, and kept fresh** by people who live with the same need — built so users
can **feel the faith they want to put behind a listing**, because the stakes are
a real allergic reaction.

Trust is not a feature of this product. Trust **is** the product. Every design
decision is judged against: *does this help a person with a gluten allergy
decide, with confidence, whether to eat here?*

---

## v1 Scope

### Launch strategy

A **single-metro public pilot, seeded in Denver, CO**. Public-facing and open to
community contributions, but deliberately focused on one metro first. For a
trust- and network-effect-driven product, **density beats breadth** — 50
well-attested Denver listings are worth more than 50 scattered nationwide.

### In scope for v1

| Capability | Notes |
| --- | --- |
| Browse / search / filter listings | List-first; filter by GF taxonomy; sort by trust/recency; "near me" distance sort |
| Listing detail page | Rich GF attributes, Google Maps deep-link, optional menu-link URL |
| Add a listing | Google Places autocomplete (default) + manual fallback, admin-toggled. See ADR-008 |
| Contribute GF attributes | Confirm / dispute each community-attested claim (one vote per user per claim) |
| "Got glutened here" incidents | Date (required) + optional severity + note; recent incidents flag the trust summary |
| Trust & freshness signals | Transparent hybrid summary over visible evidence; 6-month staleness window. See ADR-007 |
| Accounts | Google OAuth only. See ADR-006 |
| Roles & moderation | admin / moderator / user; admin-grantable moderators; flag → queue → action. See ADR-010 |
| Light rate limiting | Anti-abuse guardrail on writes |
| Admin panel | Role management, app settings (intake mode, staleness window), moderation queue |

### Explicitly deferred (tracked in the post-launch backlog)

Photo / menu **image uploads** (no blob storage in v1 — an optional menu-link
**URL** field is the v1 substitute) · embedded **map view** (we deep-link to
Google Maps instead) · **reputation scoring / badges** · **notifications** ·
**restaurant-owner claims/responses** · **multi-city** expansion · **Cloudflare**
deployment (post-launch learning exercise — see ADR-009) · **ads** (revenue,
which gates any paid-tier spend).

---

## Stance & Non-Negotiables (product-level)

- **Celiac-safe vs. gluten-friendly is the headline distinction**, surfaced
  everywhere. Conflating them is the exact failure mode this product exists to
  prevent.
- **Safety signals never rely on color alone.** Purple/pastel branding (see
  ADR for design) must not compromise accessible, high-contrast, icon+label
  safety cues.
- **Evidence is never a black box.** The trust summary is a transparent
  roll-up of visible confirm/dispute counts, recency, and incidents — not a
  secret score. See ADR-007.
- **Recent harm is never buried.** A recent "got glutened" incident visibly
  flags a listing regardless of how many old confirmations it has.
- **Every write is attributable** (login-gated) so trust and moderation have a
  foundation.

---

## Engineering Model

This project is built **agent-first**. The human (repo owner, `admin`) writes no
application code; their engagement is **judgment, not keystrokes**: provisioning
the accounts/secrets only they can hold, reviewing PRs at the product level, and
deciding genuine forks.

- Work is tracked as **GitHub Issues**: epics (sub-issues) + `blocked by`
  dependencies encode the build order. See `docs/agents/tasks.md` for the
  claim/execution protocol.
- **`safe:human` work** (auth, schema, deploys, external services) is still
  *implemented by agents*, but ships as PRs the human reviews and merges —
  **nothing auto-merges**, sensitive PRs are flagged `safe:human`.
- **Account/secret provisioning** (Google OAuth, Google Places, Neon, Vercel)
  is the human's job — tracked as dedicated checklist issues assigned to them.

---

## Hosting & Cost Posture

Free tiers only for v1 (Vercel hobby + Neon free + Google Places free
allowance). Paid spend is deferred until ad revenue exists. Deploy target is
**Vercel** via a Nitro preset; the stack stays deployment-portable so a
Cloudflare port can be a deliberate post-launch exercise (ADR-009). The
**admin can toggle listing intake to manual** if the Places API approaches its
free limit, so a cost ceiling never breaks the app (ADR-008).
