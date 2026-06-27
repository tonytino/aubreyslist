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

Tailwind v4 uses the `dark:` variant with the `@media (prefers-color-scheme)` strategy by default. To use class-based dark mode, configure it in `app/styles/app.css`:

```css
@import "tailwindcss";
@variant dark (&:where(.dark, .dark *));
```

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
| `stale` | "May be stale" | clock | outside the staleness window |
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
