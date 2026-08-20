import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` only knows Tailwind's stock scale, so it mis-groups this
 * project's custom `--text-*` / `--radius-*` tokens (from `@theme` in
 * `app/styles/app.css`) — e.g. it treats `text-body-sm` as a text color, so a
 * neighboring `text-*-foreground` silently drops the font-size, and it can't
 * tell `rounded-chip` conflicts with a stock `rounded-md`.
 *
 * Registering the custom values in the `font-size` and `rounded` groups makes
 * a later token correctly override an earlier one (including the stock
 * `text-xs`/`rounded-md` a shadcn primitive ships with). Keep this list in
 * sync with `app/styles/app.css`.
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
 * Merge class names with Tailwind-aware conflict resolution: `clsx` flattens
 * conditional inputs, then `tailwind-merge` dedupes conflicts so a later class
 * wins (`cn("px-2", "px-4")` -> `"px-4"`). The standard shadcn/ui helper —
 * every `app/components/ui/*` primitive composes through it so callers can
 * override a primitive's classes via `className`, including this project's
 * custom tokens per the config above.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
