# ADR-007: Transparent hybrid community trust model

## Status

Accepted

## Context

Trust is the product. Users with a gluten allergy need to decide, with
confidence, whether a restaurant is safe — and they've been burned by opaque or
optimistic "gluten-free" claims before. We considered three models: (1) pure
transparency — show only raw evidence and let users judge; (2) a single computed
"GF Confidence" score — easy to scan but asks users to trust *our* formula, the
exact opaque-trust failure mode we exist to fix; (3) a hybrid — a transparent
summary layer over fully visible evidence.

## Decision

Adopt the **hybrid** model: lead with a **transparent summary that is a roll-up
of visible evidence** (confirm/dispute counts, recency, recent incidents), with
the underlying evidence always available below it. The summary must be
explainable purely from evidence the user can also see — **no secret scoring.**
This preserves optionality: we can later lean toward pure transparency or a
computed score without re-architecting.

## Consequences

- Each claim renders as **distribution + recency** (e.g. "8 confirm / 1 dispute ·
  last confirmed 3 weeks ago"), never as a bare number with hidden math.
- **One attestation per user per claim**, changeable and retractable. Enforce
  server-side.
- **Staleness window is 6 months**, stored as an admin-tunable AppSetting. Stale
  claims are flagged ("may be stale"), not hidden.
- **Recent incidents visibly flag the trust summary** regardless of older
  confirmations — fresh harm is never buried.
- Do not introduce reputation-weighted or ML-derived scoring in v1; if proposed
  later it needs its own ADR.
- Full mechanics live in `docs/agents/domain.md` (Trust Model section).
