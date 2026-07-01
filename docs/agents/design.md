# Design

Visual identity and design language for Aubrey's List. This is the **why and the
feel**; the **how** (Tailwind v4 tokens, CSS rules) lives in
[`styling.md`](./styling.md), and the **domain meaning** of safety states lives
in [`domain.md`](./domain.md). When briefing Claude Design or the
frontend-design skill, start here.

## The decision rule

Aubrey's List is **modern & vibrant in expression, on top of a clean,
accessibility-correct, purple-led palette.** Reach for energy through motion,
bold use of the brand purple, generous food imagery, and confident spatial
layout — never by weakening contrast, leaning on color to carry meaning, or
diluting the safety signals. When "vibrant" and "accessible" conflict,
accessible wins, every time.

## Non-negotiables (these override everything below)

1. **Safety signals never rely on color alone.** Every safety state pairs a
   color **with an icon AND a text label** (the `SafetySignal` component is the
   single source of truth). Pastels are decorative fills only — never
   load-bearing for meaning. This is a celiac-safety product; being wrong can
   make someone sick.
2. **WCAG AA minimum (≥ 4.5:1) for all text and meaningful UI.** The
   `*-foreground` tokens are already tuned for this against their `*-soft`
   backgrounds and against white. Don't introduce color combinations that
   haven't been checked.
3. **Mobile-first.** People use this standing outside a restaurant deciding
   whether to walk in. Design the small screen first; enhance up.

## Who it's for and what they should feel

A person with celiac disease or a serious gluten-free need, often deciding in
the moment. Four feelings should come through at once:

- **Safe & reassured** — "I can trust this." Clear safety states, freshness/
  recency cues, visible sourcing of claims.
- **Empowered & in control** — "I can decide for myself." Strong filters,
  transparency, the underlying data within reach.
- **Part of a community** — "Real people like me contributed this." Contributor
  presence, reviews, human warmth — not a faceless database.
- **Fast & efficient** — "I found it in seconds." Scannable, low-friction,
  quick to the answer.

## Reference points

- **Yelp / Google Maps** for the *discovery patterns* — map-forward local
  search, dense-but-scannable listing cards, familiar review affordances.
- **Premium food guides** (Eater / Michelin / The Infatuation) for the *polish*
  — editorial confidence, opinionated curation, photography that makes the food
  feel worth seeking out.

The blend: Yelp's utility with a food-guide's taste, rendered in our purple.

## Expression levers — how to be "vibrant" without breaking the palette

The palette is fixed; the *energy* comes from how you use it:

- **Motion** — purposeful transitions, scroll-aware reveals, micro-interactions
  on cards/filters/ratings. Motion should aid comprehension, never decorate for
  its own sake; respect `prefers-reduced-motion`.
- **Bold brand purple** — let `--color-brand` lead hero moments, primary
  actions, and key wayfinding instead of sitting back as an accent.
- **Generous imagery** — restaurant/food photography is a first-class design
  element, not a thumbnail afterthought (the food-guide influence).
- **Confident spatial composition** — clear hierarchy, asymmetry where it helps
  scanning, breathing room via the `--spacing-section` rhythm.
- **Pastel accents** (`--color-accent-*`) for warmth and zoning of surfaces —
  decorative only, never to signal safety.

## The palette in one glance (source of truth: `app/styles/app.css`)

- **Brand:** purple-led — `--color-brand` / `-strong` / `-soft` / `-ring`.
- **Decorative accents:** lavender, mint, peach, sky (fills only).
- **Safety states** (color + icon + label, AA-tuned; see `domain.md`):
  - `celiac-safe` — trustworthy green
  - `gluten-friendly` — caution amber/brown, deliberately distinct from safe
  - `stale` — neutral slate (a freshness/recency flag)
  - `incident` — strong red, highest urgency ("got glutened")
- **Type scale:** caption → body → lead → title → headline → display.
- **Spacing:** semantic `--spacing-gutter` / `-card` / `-section`.
- **Radii:** `--radius-chip` (pill), `--radius-card`.

## Briefing Claude Design (and the frontend-design skill)

When you start a screen in Claude Design, give it: this direction (modern &
vibrant on a fixed purple palette), the non-negotiables above, the relevant
safety states from `domain.md`, and the token seed from `app/styles/app.css` so
generated output lands on-brand. When the design is ready, export the **handoff
bundle** and bring it to Claude Code — implementation rules (Tailwind utilities
only, no inline styles, no `@apply`) are in [`styling.md`](./styling.md).
