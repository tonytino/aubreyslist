import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` only knows Tailwind's STOCK scale by default, so it can't
 * classify this project's custom CSS-first design tokens (the `--text-*` and
 * `--radius-*` utilities defined under `@theme` in `app/styles/app.css`). Left
 * unregistered, twMerge mis-groups them — e.g. it treats `text-body-sm` as a
 * text-COLOR (not a font-size), so composing it beside a `text-*-foreground`
 * colour silently DROPS the font-size, and it can't tell `rounded-chip` conflicts
 * with a stock `rounded-md`, leaving both. That broke the badge family's shared
 * size (AUB-224): the headline lost its font-size while the claim badge fell back
 * to the primitive's `text-xs`, so they rendered at different sizes.
 *
 * Registering every custom `--text-*` value in the `font-size` group and every
 * custom `--radius-*` value in the `rounded` group teaches twMerge to treat them
 * as the font-size / border-radius utilities they are, so a later token correctly
 * overrides an earlier one (including the stock `text-xs`/`rounded-md` a shadcn
 * primitive ships with). Keep this list in sync with `app/styles/app.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption",
            "body-sm",
            "body",
            "lead",
            "title",
            "card-title",
            "headline",
            "display",
          ],
        },
      ],
      rounded: [{ rounded: ["chip", "card"] }],
    },
  },
});

/**
 * Merge class names with Tailwind-aware conflict resolution.
 *
 * `clsx` flattens conditional/array/object class inputs; `tailwind-merge` then
 * dedupes conflicting Tailwind utilities so a later class wins (e.g.
 * `cn("px-2", "px-4")` -> `"px-4"`). This is the standard shadcn/ui helper and
 * the single entry point every `app/components/ui/*` primitive composes through,
 * so callers can always override a primitive's classes via `className`. The
 * `extendTailwindMerge` config above makes that override work for this project's
 * custom `--text-*` / `--radius-*` tokens too.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
