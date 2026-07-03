import { ArrowUpDown } from "lucide-react";
import { BROWSE_SORT_OPTIONS, type BrowseSort, parseBrowseSort } from "~/listings/sort";

/**
 * Sort selector chip (AUB-198).
 *
 * The server-side sort control, surfaced directly in the filter chip row now that
 * the "Filter listings" sheet is retired. Mirrors {@link DistanceSelector} exactly:
 * the WHOLE control is a single native `<select>` styled as a chip, so clicking
 * anywhere on it opens the options. The ArrowUpDown glyph is a decorative,
 * click-through overlay.
 *
 * ACCESSIBLE: a real `<select>` with an explicit `aria-label` ("Sort by") — native
 * keyboard + screen-reader support, and the same accessible name the old sheet's
 * labelled control carried (so `getByLabel("Sort by")` selectors keep working).
 *
 * URL-DRIVEN / PRESENTATIONAL: owns no state. The value comes from `?sort=` via the
 * route and every change reports through `onChange` — the route's `changeSort`
 * handles the URL navigation, including the "Near me" geolocation opt-in flow.
 */
export function SortSelector({
  value,
  onChange,
}: {
  /** The active sort (one of {@link BROWSE_SORT_OPTIONS}, from `?sort=`). */
  value: BrowseSort;
  /** Called with the newly-chosen sort when the selection changes. */
  onChange: (sort: BrowseSort) => void;
}) {
  return (
    <div className="relative inline-flex shrink-0 items-center">
      <ArrowUpDown
        className="pointer-events-none absolute left-3 size-4 text-brand"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <select
        value={value}
        onChange={(event) => onChange(parseBrowseSort(event.target.value))}
        aria-label="Sort by"
        className="cursor-pointer appearance-none rounded-chip border border-border bg-surface py-2 pl-9 pr-3 text-body-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {BROWSE_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
