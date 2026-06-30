import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind-aware conflict resolution.
 *
 * `clsx` flattens conditional/array/object class inputs; `tailwind-merge` then
 * dedupes conflicting Tailwind utilities so a later class wins (e.g.
 * `cn("px-2", "px-4")` -> `"px-4"`). This is the standard shadcn/ui helper and
 * the single entry point every `app/components/ui/*` primitive composes through,
 * so callers can always override a primitive's classes via `className`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
