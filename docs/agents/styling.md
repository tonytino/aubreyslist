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

## Responsive Design

Use Tailwind's mobile-first breakpoint prefixes:

```tsx
<div className="flex flex-col md:flex-row lg:gap-8" />
```

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
| `gluten-friendly` | "Gluten-friendly" | info circle | GF-ish only — *not* safe |
| `stale` | "Stale listing" | clock | outside the staleness window |
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

### Icons — Phosphor, SSR import only

Use `@phosphor-icons/react`, imported from the **SSR-safe entrypoint** (this is an
SSR app):

```tsx
import { ShieldCheck, Plus } from "@phosphor-icons/react/dist/ssr";

<Plus weight="bold" className="h-4 w-4" />
```

Never import from the barrel `@phosphor-icons/react` in app code — it causes
SSR/bundle issues. Do not swap the `SafetySignal` SVGs for Phosphor unless each
safety state keeps a distinct greyscale-survivable shape (a reviewed change).
