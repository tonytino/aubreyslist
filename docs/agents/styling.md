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
