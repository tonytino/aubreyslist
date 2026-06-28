import { type ClaimAttribute, claimAttributes } from "~/db/schema";
import { claimAttributeLabel } from "~/trust/summary";

/**
 * GF taxonomy filter (issue #35, the killer feature — domain.md → Discovery).
 *
 * Lets a visitor narrow the browse list to places that meet their bar across the
 * FIXED 7-attribute taxonomy (e.g. "celiac-safe + dedicated fryer"). The
 * attribute set is the `claim_attribute` enum (single source of truth), so this
 * stays in lockstep with the taxonomy automatically — add an attribute to the
 * schema and it appears here.
 *
 * URL-DRIVEN / PRESENTATIONAL: this component owns no state. The selected set
 * comes in as a prop (derived from `?attrs=` in the route) and every toggle
 * calls `onToggle`, which the route turns into a URL navigation. That keeps the
 * filter shareable, SSR-friendly, and back/forward-correct, mirroring the
 * existing `?page=` pattern.
 *
 * ACCESSIBLE (styling.md, NON-NEGOTIABLE): rendered as a real `<fieldset>` of
 * labeled checkboxes inside a `<legend>`-titled group. Selected state is carried
 * by the native checkbox (checkmark + `aria-checked`), never colour alone, so it
 * survives colour-blindness and greyscale.
 *
 * CLIENT-SAFE: imports only the client-safe `claimAttributes` value + the pure
 * `claimAttributeLabel` from `app/trust/summary.ts` — no `getDb`/server import.
 */

interface TaxonomyFilterProps {
  /** The currently-selected attributes (from `?attrs=`). */
  selected: readonly ClaimAttribute[];
  /** Toggle a single attribute on/off; the route maps this to a URL change. */
  onToggle: (attribute: ClaimAttribute) => void;
  /** Clear all selected attributes; the route maps this to a URL change. */
  onClear: () => void;
}

export function TaxonomyFilter({ selected, onToggle, onClear }: TaxonomyFilterProps) {
  const selectedSet = new Set(selected);
  const hasSelection = selectedSet.size > 0;

  return (
    <fieldset className="mt-section rounded-card border border-border bg-surface p-gutter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-body-sm font-semibold text-foreground">
          Filter by gluten-free attributes
        </legend>
        {hasSelection ? (
          <button
            type="button"
            onClick={onClear}
            className="text-body-sm font-semibold text-brand hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring rounded-chip px-1"
          >
            Clear ({selectedSet.size})
          </button>
        ) : null}
      </div>

      <p className="mt-1 text-caption text-muted-foreground">
        Show only places the community has affirmed for every attribute you pick.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:grid sm:grid-cols-2">
        {claimAttributes.map((attribute) => {
          const checked = selectedSet.has(attribute);
          return (
            <label
              key={attribute}
              className="flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-body-sm text-foreground hover:bg-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-ring"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(attribute)}
                className="h-4 w-4 shrink-0 rounded border-border text-brand focus:ring-brand-ring"
              />
              <span>{claimAttributeLabel(attribute)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
