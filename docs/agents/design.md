# Design

Visual identity and design language. The **how** (Tailwind v4 tokens, CSS rules)
is in [`styling.md`](./styling.md); the **domain meaning** of safety states is in
[`domain.md`](./domain.md). Start here when briefing Claude Design or the
frontend-design skill.

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
   `*-foreground` tokens are tuned for this against their `*-soft` backgrounds
   and against white. Don't introduce unchecked color combinations.
3. **Mobile-first.** People use this standing outside a restaurant deciding
   whether to walk in. Design the small screen first; enhance up.

## Who it's for and what they should feel

A person with celiac disease or a serious gluten-free need, often deciding in
the moment. Four feelings at once:

- **Safe & reassured** — clear safety states, freshness/recency cues, visible
  sourcing of claims.
- **Empowered & in control** — strong filters, transparency, underlying data
  within reach.
- **Part of a community** — contributor presence, reviews, human warmth; not a
  faceless database.
- **Fast & efficient** — scannable, low-friction, quick to the answer.

## Reference points

- **Yelp / Google Maps** for discovery patterns — map-forward local search,
  dense-but-scannable listing cards, familiar review affordances.
- **Premium food guides** (Eater / Michelin / The Infatuation) for polish —
  editorial confidence, opinionated curation, photography that makes the food
  feel worth seeking out.

The blend: Yelp's utility with a food-guide's taste, in our purple.

## Expression levers — "vibrant" without breaking the palette

The palette is fixed; the energy comes from how you use it:

- **Motion** — purposeful transitions, scroll-aware reveals, micro-interactions
  on cards/filters/ratings. Motion aids comprehension, never decorates; respect
  `prefers-reduced-motion`.
- **Bold brand purple** — let `--color-brand` lead hero moments, primary
  actions, and key wayfinding.
- **Generous imagery** — restaurant/food photography as a first-class design
  element, not a thumbnail afterthought.
- **Confident spatial composition** — clear hierarchy, asymmetry where it helps
  scanning, breathing room via the `--spacing-section` rhythm.
- **Pastel accents** (`--color-accent-*`) for warmth and zoning — decorative
  only, never to signal safety.

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

Give it: this direction (modern & vibrant on a fixed purple palette), the
non-negotiables above, the relevant safety states from `domain.md`, and the
token seed from `app/styles/app.css`. When the design is ready, export the
**handoff bundle** and bring it to Claude Code — implementation rules (Tailwind
utilities only, no inline styles, no `@apply`) are in
[`styling.md`](./styling.md).
