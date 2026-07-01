# Styling

Framework: Tailwind CSS v4 with the Oxide (Rust) engine.

## Key Differences from Tailwind v3

- No `tailwind.config.ts`. Configuration is CSS-first.
- Customize via CSS variables in `app/styles/app.css`.
- The `@apply` directive still works but should be avoided.

## app/styles/app.css

This is the only global stylesheet. Keep it minimal:

```css
@import "tailwindcss";

/* Theme customization via CSS variables */
@theme {
  --color-brand: #6366f1;
  --font-sans: "Inter", sans-serif;
}
```

The starter routes use the `text-muted-foreground` utility for secondary text;
its backing `--color-muted-foreground` token is defined in `app/styles/app.css`.
Tailwind v4 emits nothing for an undefined color utility, so the token must
exist for the class to render.

## Rules

- Use Tailwind utility classes exclusively in JSX.
- No inline `style` props unless driven by dynamic runtime values (e.g., calculated widths, CSS custom properties set at runtime).
- No component-scoped CSS files or CSS modules.
- No `@apply` — compose utilities in JSX, not in CSS.

## Mobile-first (NON-NEGOTIABLE)

**Design and build mobile-first.** Start from the smallest screen and layer
enhancements up with Tailwind's breakpoint prefixes — never the reverse. The
unprefixed utility is the mobile base; `sm:`/`md:`/`lg:` add to it.

```tsx
{/* base = mobile; widen only at larger breakpoints */}
<div className="flex flex-col gap-4 md:flex-row md:gap-8" />
```

- **Minimum supported width: 375px (iPhone SE).** Every layout must work, with no
  horizontal overflow or clipped content, down to 375px. Verify new UI at 375px,
  not just at desktop.
- **Prefer one consistent experience across breakpoints** over divergent
  mobile/desktop designs, unless there's a clear reason to differ. Fewer
  viewport-conditional branches means fewer places to regress.
- **The site header is the canonical example** (`app/components/SiteHeader.tsx`):
  a hamburger menu (left) + centred wordmark + right-aligned controls, identical
  at every size. When a control can't fit at 375px, shrink it (smaller wordmark,
  compact button) rather than introducing a separate desktop layout.
- When you change a header/nav element's role, label, or visibility, re-check the
  e2e selectors in `tests/e2e/` (and component tests) that target it — a
  mobile-first restructure commonly moves an inline element into a menu.

## Dark Mode

Dark mode is **implemented and class-based** (ADR-011). It works through three pieces:

1. **The variant** — `@variant dark (&:where(.dark, .dark *));` near the top of
   `app/styles/app.css` switches Tailwind v4 from the default
   `@media (prefers-color-scheme)` strategy to the `.dark` class strategy.
2. **The token layer** — a `.dark { … }` block at the end of `app/styles/app.css`
   overrides the runtime `--color-*` custom properties for the dark palette
   (neutrals + the shadcn semantic layer). The `@theme` light values are never
   touched. Two rules to preserve when editing it:
   - **Override `--color-primary` independently of `--color-brand`.** The brand is
     lightened in `.dark` so `text-brand` reads on dark surfaces, but a *lightened*
     primary fails WCAG AA for white button/tooltip text — so `--color-primary` is
     pinned darker (~`oklch(0.50 0.21 295)`) where white reaches ≥ 4.5:1.
   - **The safety `-soft` fills are overridden but kept light**, because the
     `SafetySignal` `soft` variant draws its text in the *strong* safety colour
     (not white). Light fills keep that text AA-legible; never make them dark.
3. **No-FOUC + toggle** — a blocking inline script in `app/routes/__root.tsx`
   reads `localStorage.theme` (falling back to `prefers-color-scheme`) and sets the
   `.dark` class on `<html>` **before first paint**, so dark users see no flash.
   `app/components/ThemeToggle.tsx` (in the site header) flips and persists the
   choice; it initialises to `"light"` (matching SSR) and reconciles to the applied
   theme in a post-mount effect to avoid a hydration mismatch.

When adding tokens, add the light value under `@theme` **and** a matching `.dark`
override, and re-check AA contrast for both themes.

## Brand & Design Tokens (issue #12)

Direction: clean / clinical-but-warm, mobile-first, **purple-led** with soft
**pastel** accents. All tokens live in `app/styles/app.css` under `@theme`, so
they surface as Tailwind v4 utilities — never reach for inline styles or
`@apply`.

### Token groups

| Group | Tokens | Utility examples |
| --- | --- | --- |
| Brand | `--color-brand`, `-foreground`, `-strong`, `-soft`, `-ring` | `bg-brand`, `text-brand`, `hover:bg-brand-strong`, `bg-brand-soft` |
| Pastel accents (decorative only) | `--color-accent-{lavender,mint,peach,sky}` | `bg-accent-mint` |
| Neutrals | `--color-{background,foreground,surface,border}`, `--color-muted-foreground` (kept — starter routes depend on it) | `bg-background`, `text-foreground`, `border-border` |
| Safety states | `--color-{celiac-safe,gluten-friendly,stale,incident}` + `-foreground` + `-soft` | use the `SafetySignal` component, not raw classes |
| Type scale | `--text-{caption,body-sm,body,lead,title,headline,display}` | `text-display`, `text-body` |
| Spacing | `--spacing-{gutter,card,section}` | `p-gutter`, `gap-section` |
| Radii | `--radius-{chip,card}` | `rounded-chip`, `rounded-card` |

### Accessible safety-signal pattern (NON-NEGOTIABLE)

The celiac-safe vs. gluten-friendly distinction (and every status cue) **must
never rely on colour alone** (see `docs/product/overview.md` → Stance &
Non-Negotiables, and `docs/agents/domain.md`). Use the `SafetySignal` component
(`app/components/SafetySignal.tsx`) — it guarantees **colour + icon + text
label** for all four states:

| State | Label | Icon shape | Meaning |
| --- | --- | --- | --- |
| `celiac-safe` | "Celiac-safe" | shield + check | headline trust state |
| `gluten-friendly` | "Gluten-friendly" | leaf | GF-ish only — *not* safe |
| `stale` | "Needs update" | clock | outside the staleness window |
| `incident` | "Recent incident" | warning triangle | recent "got glutened" harm |

```tsx
import { SafetySignal } from "~/components/SafetySignal";

<SafetySignal state="celiac-safe" />                 {/* soft pastel chip */}
<SafetySignal state="incident" variant="solid" />     {/* high-emphasis */}
<SafetySignal state="incident" label="Recent incident · 3 days ago" />
```

Contract: the icon is `aria-hidden` and meaning lives in the visible text label,
so screen readers announce the words while sighted users with colour-vision
deficiency still get a distinct icon shape + label. The `*-foreground` tokens
meet WCAG AA (>= 4.5:1) on white and on their `*-soft` fills; pastels are fills
only and never carry meaning by themselves. Each state's icon SHAPE is distinct,
so the signal survives greyscale.

`SAFETY_STATES` and `safetyLabel()` are exported for legends, filters, and the
`/style-guide` route, which showcases the palette, type scale, and every signal.

The header wordmark is `app/components/Wordmark.tsx` (`<Wordmark size="lg" />`).

## Component primitives (shadcn/ui — ADR-011)

Reusable primitives live in `app/components/ui/` (shadcn New-York style,
hand-authored — the CLI registry is network-blocked, so add new ones from the
upstream shadcn source and adapt them). They compose through `cn()` in
`~/lib/utils.ts` and render on the brand palette via a **shadcn semantic token
layer** in `app/styles/app.css` (`bg-primary`, `border-input`, `bg-destructive`,
`ring-ring`, `bg-card`, …) that maps onto the existing brand/safety/neutral
tokens. That layer is **additive** — never replace the brand or safety tokens
with a stock `shadcn init` `:root` set.

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
SSR-safe, so there is no separate entrypoint (unlike the Phosphor library it
replaced; see ADR-011):

```tsx
import { ShieldCheck, Plus } from "lucide-react";

<Plus className="h-4 w-4" />
```

Conventions:

- **Sizing** — pass a `size` prop (pixels) or a Tailwind `size-*` / `h-* w-*`
  utility. Keep icon sizes visually equivalent to the surrounding text/control.
- **Stroke weight** — lucide icons are stroked; the default `strokeWidth` is `2`.
  For bold emphasis use `strokeWidth={2.4}` (this is the equivalent of Phosphor's
  old `weight="bold"`).
- **Filled icons** — lucide has no `weight="fill"`. When an icon must read as a
  solid shape (e.g. a selected radio dot), fill the outline with the current text
  colour via the Tailwind `fill-current` utility:

  ```tsx
  <Circle className="size-2 fill-current" aria-hidden="true" />
  ```

`SafetySignal` uses lucide icons — one distinct, greyscale-survivable shape per
state (`ShieldCheck` / `Leaf` / `Clock` / `TriangleAlert`). Keep them distinct
if you ever revisit the mapping; the shape is load-bearing, not just the colour.
