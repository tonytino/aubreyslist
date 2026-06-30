# ADR-011: shadcn/ui as the component layer (adopted on top of the existing token system)

## Status

Accepted

## Context

The app had a deliberate, accessible design-token system (OKLCH brand palette,
type scale, semantic spacing/radii, and the `SafetySignal` colour+icon+label
contract) but no reusable component primitives — every button, card, and field
was bespoke Tailwind in each route, and the brand tokens were barely used outside
`/style-guide`. We needed a fast, consistent way to build UI, a shared surface to
prototype against (including with the Claude desktop app), and richer visuals.

The choice was: hand-roll a minimal primitive set, or adopt shadcn/ui. shadcn is
not a runtime dependency — it is copy-in source (Radix primitives + CVA + a `cn`
merge helper) that lives in the repo. The risk is token collision: shadcn ships
its own semantic variable set, and this repo is Tailwind v4 CSS-first with an
established OKLCH palette, so a naive `shadcn init` would duplicate and fight what
exists.

## Decision

We adopt shadcn/ui (New-York style, React 19 / `data-slot` variant) as the
component layer, reconciled onto the existing tokens rather than replacing them.
The shadcn CLI registry is network-blocked in CI/web environments, so components
are hand-authored from the canonical sources into `app/components/ui/`;
`components.json` and `~/lib/utils.ts` (`cn`) are wired so `npx shadcn add` works
unchanged once network allows. Phosphor (`@phosphor-icons/react`) is the icon
library.

## Consequences

- **Token reconciliation is additive, never destructive.** shadcn's semantic
  utilities (`bg-primary`, `border-input`, `bg-destructive`, `ring-ring`, …) are
  defined in `app/styles/app.css` as a layer that maps onto the existing brand /
  safety / neutral tokens. The brand, safety, type, spacing, and radius tokens are
  untouched. Do not introduce a parallel `:root` HSL set the way a stock
  `shadcn init` would.
- **Primitives live in `app/components/ui/`** (lowercase filenames, the shadcn
  convention). Domain components (`SafetySignal`, `ListingCard`, etc.) stay where
  they are and may compose the primitives.
- **The `SafetySignal` contract is not shadcn's job.** Safety meaning must remain
  colour + icon + text (see `docs/agents/styling.md`, ADR-007). Do not replace the
  hand-rolled safety SVGs with generic icons unless each state keeps a distinct
  greyscale-survivable shape — that is a deliberate, reviewed change, not a sweep.
- **Phosphor must use the SSR-safe import path.** This is an SSR app; import icons
  from `@phosphor-icons/react/dist/ssr` (e.g.
  `import { ShieldCheck } from "@phosphor-icons/react/dist/ssr"`), not the barrel
  `@phosphor-icons/react`, to avoid SSR/bundle issues.
- **CLI works later, by hand for now.** Because the registry is blocked, new
  components are hand-authored from the upstream shadcn source and adapted to use
  `~/lib/utils` and the reconciled tokens. When the registry becomes reachable,
  `npx shadcn add <component>` resolves against the committed `components.json`.
- **New runtime deps:** `class-variance-authority`, `clsx`, `tailwind-merge`,
  `@radix-ui/react-slot`, `@radix-ui/react-label`, `@phosphor-icons/react`. Pull in
  additional `@radix-ui/*` primitives per-component only when a component needs
  them (dialog, popover, dropdown, etc.) — do not add them speculatively.
- **Dark mode is class-based, via a `.dark` runtime-override layer.** The
  `@variant dark (&:where(.dark, .dark *))` directive in `app/styles/app.css`
  enables the class strategy, and a `.dark { … }` block overrides the runtime
  `--color-*` custom properties (neutrals + the shadcn semantic layer; brand
  lightened for legibility on dark, with `--color-primary` overridden
  independently so white button/tooltip text stays WCAG AA). The `@theme` light
  values are never mutated. A blocking no-FOUC inline script in
  `app/routes/__root.tsx` sets the `.dark` class from `localStorage.theme`
  (falling back to `prefers-color-scheme`) before first paint, and
  `app/components/ThemeToggle.tsx` flips/persists it. See `docs/agents/styling.md`
  → Dark Mode. The safety `-soft` fills are overridden in `.dark` but kept light
  so the `SafetySignal` strong-colour text stays AA — the colour+icon+label
  contract holds in both themes.
