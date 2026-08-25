# Styling

Framework: Tailwind CSS v4 (Oxide engine). Configuration is CSS-first — there
is no `tailwind.config.ts`; customize via CSS variables in
`app/styles/app.css`.

## app/styles/app.css

The only global stylesheet. Keep it minimal:

```css
@import "tailwindcss";

/* Theme customization via CSS variables */
@theme {
  --color-brand: #6366f1;
  --font-sans: "Inter", sans-serif;
}
```

Tailwind v4 emits nothing for an undefined color utility — a utility's backing
token (e.g. `--color-muted-foreground` for `text-muted-foreground`) must exist
in `app/styles/app.css` for the class to render.

## Rules

- Use Tailwind utility classes exclusively in JSX.
- No inline `style` props unless driven by dynamic runtime values (calculated
  widths, CSS custom properties set at runtime).
- No component-scoped CSS files or CSS modules.
- No `@apply` — compose utilities in JSX, not in CSS.

## Mobile-first (NON-NEGOTIABLE)

**Design and build mobile-first.** The unprefixed utility is the mobile base;
`sm:`/`md:`/`lg:` add to it — never the reverse.

```tsx
{/* base = mobile; widen only at larger breakpoints */}
<div className="flex flex-col gap-4 md:flex-row md:gap-8" />
```

- **Minimum supported width: 375px (iPhone SE).** Every layout must work, with
  no horizontal overflow or clipped content, down to 375px. Verify new UI at
  375px, not just at desktop.
- **Prefer one consistent experience across breakpoints** over divergent
  mobile/desktop designs, unless there's a clear reason to differ. Fewer
  viewport-conditional branches, fewer places to regress.
- **The site header is the canonical example**
  (`app/components/SiteHeader.tsx`): mobile-first with a single breakpoint
  switch at `sm` (640px). Below `sm`: a left-aligned wordmark and one
  thumb-reachable, right-anchored combined menu (`app/components/SiteMenu.tsx`)
  whose panel groups a **Navigate** section and an **Account** section (the
  theme toggle folds in as a row). At `sm:`+: wordmark + inline primary `<nav>`
  + standalone theme toggle + separate account menu
  (`app/components/UserMenu.tsx`). The `<nav aria-label="Primary">` landmark
  and the account rows are shared across both layouts, so they can't drift.
- When you change a header/nav element's role, label, or visibility, re-check
  the e2e selectors in `tests/e2e/` (and component tests) that target it — a
  mobile-first restructure commonly moves an inline element into a menu.

## Dark Mode

Dark mode is class-based (ADR-011), via three pieces:

1. **The variant** — `@custom-variant dark (&:where(.dark, .dark *));` near the
   top of `app/styles/app.css` switches Tailwind v4 from the
   `@media (prefers-color-scheme)` strategy to the `.dark` class strategy.
2. **The token layer** — a `.dark { … }` block at the end of
   `app/styles/app.css` overrides the runtime `--color-*` custom properties for
   the dark palette. The `@theme` light values are never touched. Two rules to
   preserve when editing it:
   - **Override `--color-primary` independently of `--color-brand`.** The brand
     is lightened in `.dark` so `text-brand` reads on dark surfaces, but a
     lightened primary fails WCAG AA for white button/tooltip text — so
     `--color-primary` is pinned darker (~`oklch(0.50 0.21 295)`) where white
     reaches ≥ 4.5:1.
   - **The safety `-soft` fills are overridden but kept light**, because the
     `SafetySignal` `soft` variant draws its text in the *strong* safety colour
     (not white). Light fills keep that text AA-legible; never make them dark.
3. **No-FOUC + toggle** — a blocking inline script in `app/routes/__root.tsx`
   reads `localStorage.theme` (falling back to `prefers-color-scheme`) and sets
   the `.dark` class on `<html>` **before first paint**.
   `app/components/ThemeToggle.tsx` flips and persists the choice; it
   initialises to `"light"` (matching SSR) and reconciles to the applied theme
   in a post-mount effect to avoid a hydration mismatch.

When adding tokens, add the light value under `@theme` **and** a matching
`.dark` override, and re-check AA contrast for both themes.

## Brand & Design Tokens

Direction: clean / clinical-but-warm, mobile-first, **purple-led** with soft
**pastel** accents. All tokens live in `app/styles/app.css` under `@theme`, so
they surface as Tailwind v4 utilities — never reach for inline styles or
`@apply`.

### Token groups

| Group | Tokens | Utility examples |
| --- | --- | --- |
| Brand | `--color-brand`, `-foreground`, `-strong`, `-soft`, `-ring` | `bg-brand`, `text-brand`, `hover:bg-brand-strong`, `bg-brand-soft` |
| Pastel accents (decorative only) | `--color-accent-{lavender,mint,peach,sky}` | `bg-accent-mint` |
| Neutrals | `--color-{background,foreground,surface,border}`, `--color-muted-foreground` | `bg-background`, `text-foreground`, `border-border` |
| Safety states | `--color-{celiac-safe,stale,incident}` + `-foreground` + `-soft` | use the `SafetySignal` component, not raw classes |
| Type scale | `--text-{caption,body-sm,body,lead,title,headline,display}` | `text-display`, `text-body` |
| Spacing | `--spacing-{gutter,card,section}` | `p-gutter`, `gap-section` |
| Radii | `--radius-{chip,card}` | `rounded-chip`, `rounded-card` |

### Accessible safety-signal pattern (NON-NEGOTIABLE)

Every safety state (and every status cue) **must never rely on colour alone**
(see `docs/product/overview.md` → Stance & Non-Negotiables, and
`docs/agents/domain.md`). Use the `SafetySignal` component
(`app/components/SafetySignal.tsx`) — it guarantees **colour + icon + text
label** for all three states:

| State | Label | Icon shape | Meaning |
| --- | --- | --- | --- |
| `celiac-safe` | "Celiac-safe" | shield + check | headline trust state |
| `stale` | "Needs update" | clock | outside the staleness window |
| `incident` | "Recent incident" | warning triangle | recent "got glutened" harm |

A listing with no state (unattested, or a disputed headline claim) renders no
chip at all. `null` is the absence of a badge, not a fourth state.

```tsx
import { SafetySignal } from "~/components/SafetySignal";

<SafetySignal state="celiac-safe" />                 {/* soft pastel chip */}
<SafetySignal state="incident" variant="solid" />     {/* high-emphasis */}
<SafetySignal state="incident" label="Recent incident · 3 days ago" />
```

Contract: the icon is `aria-hidden` and meaning lives in the visible text
label, so screen readers announce the words while sighted users with
colour-vision deficiency still get a distinct icon shape + label. The
`*-foreground` tokens meet WCAG AA (>= 4.5:1) on white and on their `*-soft`
fills; pastels are fills only and never carry meaning by themselves. Each
state's icon SHAPE is distinct, so the signal survives greyscale.

`SAFETY_STATES` and `safetyLabel()` are exported for legends, filters, and the
`/style-guide` route, which showcases the palette, type scale, and every
signal.

### One shared badge size (AUB-224)

The whole badge family — the headline `SafetySignal` chip AND the per-claim
`ClaimBadge` (`app/components/listing/ClaimBadge.tsx`) — must render at the
EXACT same size and shape everywhere, including the listing-detail hero. There
is ONE size source: `BADGE_FAMILY_SIZE` in `app/components/badge-size.ts`
(padding, radius, text size, gap, and icon size via `[&>svg]:size-4`). Both
components compose that constant; never hand-tune
`px`/`py`/`text`/`rounded`/icon-size on an individual badge, and do not
up-scale the headline in the hero. The headline stays the primary verdict by
its SOLID colour fill + hero position, not by size; other claim badges keep
their soft/outline fill at the identical size. `SafetySignal`'s `solid`
variants carry a `border border-transparent` so their box metrics match the
bordered soft/outline badges to the pixel.

The header wordmark is `app/components/Wordmark.tsx` (`<Wordmark size="lg" />`).

### One shared chip source per concept (AUB-227)

The badge FAMILY is one visual language; each distinct chip concept has ONE
implementation, so add-listing and listing-detail can't drift. Every per-claim
chip — static AND interactive — composes ONE primitive:

- **The shared chip primitive** — `ClaimChip`
  (`app/components/listing/ClaimChip.tsx`) is the single source for the
  per-claim chip: a leading `aria-hidden` glyph + a visible text label at
  `BADGE_FAMILY_SIZE`. It is `asChild`-capable (Radix `Slot` + `Slottable`), so
  an interactive caller can render it THROUGH a real element (a `<button>`)
  that adds only its own concerns. `ClaimChip` owns just the shared visual
  (box, family size/shape, glyph, label span); fills/tints and interactive
  props stay with the caller, so nothing conflicts under `cn()` or `Slot`'s
  className merge.
- **Per-claim badge** — `ClaimBadge` (`app/components/listing/ClaimBadge.tsx`)
  is the canonical static claim chip; it composes `ClaimChip` (default
  `<span>`). The add-listing review outcome chip (`FactOutcomeChip`, exported
  from `app/components/add-listing/ReviewStep.tsx`) composes the SAME
  `ClaimChip`; it keeps distinct content (attribute icon + a
  "Confirmed"/"Disputed" outcome word in a neutral, non-safety tint) but IS the
  same component.
- **Bot "suggested" treatment** — the purple gradient provenance ring is the
  ONE `SuggestedRing` primitive
  (`app/components/listing/SuggestedRing.tsx`), shared by the `ClaimBadge`
  `suggested` variant AND the `ClaimTrustSummaryRow` provenance chip. Don't
  hand-roll the `bg-gradient-to-r from-brand via-accent-lavender …` ring again
  — wrap `SuggestedRing`.
- **Vote toggle** — `ClaimVoteControls`' `VoteBadgeButton` renders THROUGH the
  shared `ClaimChip` (`<ClaimChip asChild …><button …/></ClaimChip>`): the
  confirm/dispute toggle IS the shared badge, not a look-alike. The `<button>`
  supplies ONLY its interactive concerns — `aria-pressed`, `disabled`,
  `onClick`, the pressed safety-colour fill, the focus-visible ring — while the
  chip supplies the icon + label + family size/shape. Meaning still never rests
  on colour alone (icon + visible label + `aria-pressed`), and the button stays
  a first-class native element.
- **Parity guard** — `app/components/listing/claim-chip-parity.test.tsx` fails
  if the review chip, the detail `ClaimBadge`, OR the vote toggle's confirm
  chip diverge on the taxonomy icon/label (all sourced from `~/trust/summary`)
  or on the shared family-size class. Run it as the tripwire whenever you touch
  any of them.

## Component primitives (shadcn/ui — ADR-011)

Reusable primitives live in `app/components/ui/` (shadcn New-York style,
hand-authored — the CLI registry is network-blocked, so add new ones from the
upstream shadcn source and adapt them). They compose through `cn()` in
`~/lib/utils.ts` and render on the brand palette via a **shadcn semantic token
layer** in `app/styles/app.css` (`bg-primary`, `border-input`,
`bg-destructive`, `ring-ring`, `bg-card`, …) that maps onto the existing
brand/safety/neutral tokens. That layer is **additive** — never replace the
brand or safety tokens with a stock `shadcn init` `:root` set.

```tsx
import { Button } from "~/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";

<Button variant="default">Browse listings</Button>
<Button variant="outline" asChild><a href="/about">About</a></Button>
```

Reach for a primitive before writing bespoke Tailwind for a button/card/field.
Domain components (`SafetySignal`, `ListingCard`) stay where they are and may
compose primitives. The `SafetySignal` colour+icon+label contract is **not**
shadcn's job and must not be regressed.

### Icons — lucide-react

Use [`lucide-react`](https://lucide.dev), imported from the **barrel** — it is
SSR-safe, so there is no separate entrypoint:

```tsx
import { ShieldCheck, Plus } from "lucide-react";

<Plus className="h-4 w-4" />
```

Conventions:

- **Sizing** — pass a `size` prop (pixels) or a Tailwind `size-*` / `h-* w-*`
  utility. Keep icon sizes visually equivalent to the surrounding text/control.
- **Stroke weight** — the default `strokeWidth` is `2`. For bold emphasis use
  `strokeWidth={2.4}`.
- **Filled icons** — lucide has no fill weight. When an icon must read as a
  solid shape (e.g. a selected radio dot), fill the outline with the current
  text colour via `fill-current`:

  ```tsx
  <Circle className="size-2 fill-current" aria-hidden="true" />
  ```

`SafetySignal` uses one distinct, greyscale-survivable shape per state
(`ShieldCheck` / `Clock` / `TriangleAlert`). Keep them distinct if you revisit
the mapping; the shape is load-bearing, not just the colour. Any OTHER surface
that draws a safety state with an icon (map pins, quick chips, wizard buttons)
must source it from `safetyIcon()` in `app/components/SafetySignal.tsx`, so the
shape mapping cannot drift between surfaces.
