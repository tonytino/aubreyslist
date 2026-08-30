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
- The persisted enum key, `celiac_safe_vs_gluten_friendly` when this ADR was
  accepted, is now `celiac_safe` (AUB-297): the cosmetic rename shipped
  separately as the data-preserving enum-recreate migration
  `db/migrations/0006_wide_sprite.sql`, with no user-visible change.
- Seed catalog curation is unchanged: the curator bot still suggests the
  headline claim, and a suggestion stays provenance, never evidence.

## Update (2026-08-25)

The glance suppression scopes to the **badge and the confirmation-derived
evidence counts**. The recency line beside them sits outside it.

That line reports listing **activity**: "Updated 3 days ago", derived from
the most recent attestation across all visible claims of the listing, on any
attribute, counting confirms and disputes alike. Incidents never bump it — they
keep their own, louder signal. Beside it sits "N happy patrons": the distinct
people who confirmed at least one visible claim on the listing and have never
reported an incident on it, hidden at zero. It takes the place of the
celiac-scoped confirmation count, and the separate contributor count is
dropped.

Both values stay derivable from evidence a visitor can also see, and neither is
per-user reconstructible: attestations surface as anonymous counts, so "12
happy patrons" reveals no more about who voted than the save-count pill does
about who saved.

Activity shows for a contested listing exactly as it does for an affirmed one.
That is honest only because the line makes no safety assertion and the
clarifier always travels with it: "Reflects recent claim activity on this
listing, not a safety verification." Every surface that can host an interactive
trigger carries it as a tap-reachable tooltip; the map mini-card, a single
button end to end, carries a short form in its accessible name. The clarifier
is part of the rule, not decoration.

### Consequences

- Cards share one anatomy — media, title row, chips row, divider, meta row —
  whatever a listing knows. A listing with no attestations reads "No activity
  yet" rather than reserving a blank line, so a suggestion-only card and a
  heavily-attested one read as the same kind of object. Map mini-cards mirror
  it as far as their width allows: the activity line, without the count, and as
  plain text rather than a tooltip trigger (the whole mini-card is a button, so
  a nested one would be an accessibility defect).
- The badge derivation and the "contested reads as unattested" gate on the
  badge and evidence counts are unchanged, and the trust-model invariants still
  pin them.
- The `recent` ("Recently verified") quick filter still reads the celiac-gated
  freshness rule, so it can never return a badge-less card.
