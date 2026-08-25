# ADR-016: Celiac-safe is the only community safety claim

## Status

Accepted

## Context

The headline claim carried two safety states: `celiac-safe` when confirms led,
and a `gluten-friendly` state when disputes did. The lesser state was meant as
a caution, but it reads as a verdict — a badge that says "gluten-friendly" on a
celiac-safety product tells a user something the community never attested, and
a disputed claim is exactly the case where the platform knows least. Every
listing is already assumed to have gluten-free options, so the second state
carried no information a user could act on.

## Decision

**Celiac-safe is the only community safety claim.** A listing either earns it
or shows nothing. A disputed headline claim (disputes tie or outnumber
confirms) renders identically to an unattested one. Refines ADR-007, which
still governs the transparent-roll-up model this reading derives from.

## Consequences

- `SafetyState` is `celiac-safe | stale | incident`. There is no lesser badge;
  `null` is the absence of a state, not a fourth one.
- At glance level (cards, map pins, detail hero, filters) a disputed claim
  withholds the badge, the freshness cue AND the evidence counts, so a
  contested card is byte-identical to a never-reviewed one. The app declines to
  adjudicate rather than hinting at a verdict through a side channel.
- Claim rows keep the confirm/dispute counts and recency — the contest stays
  legible where the evidence lives (ADR-007: no hidden scoring).
- Incident signals are exempt: recent harm always surfaces, whatever the claim
  says.
- "Most trusted" sort ranks celiac-safe (4) above stale (3) above everything
  else (1); tier 2 is vacant. Quick filters are `celiac` and `recent` only.
- The persisted enum key `celiac_safe_vs_gluten_friendly` stays. Renaming it
  forces an enum type-recreate migration for no user-visible gain.
- Seed catalog curation is unchanged: the curator bot still suggests the
  headline claim, and a suggestion stays provenance, never evidence.
