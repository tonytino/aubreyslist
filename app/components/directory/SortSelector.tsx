import { ArrowUpDown } from "lucide-react";
import { BROWSE_SORT_OPTIONS, type BrowseSort, parseBrowseSort } from "~/listings/sort";

/**
 * Sort selector chip — the server-side sort control in the filter chip row.
 * Mirrors {@link DistanceSelector} exactly: the whole control is a single
 * native `<select>` styled as a chip, so clicking anywhere on it opens the
 * options. The ArrowUpDown glyph is a decorative, click-through overlay.
 *
 * Sized to the SELECTED option, not the widest one. A native `<select>` takes
 * its intrinsic width from the longest `<option>`, which left "Near me"
 * sitting in a chip wide enough for "Alphabetical (A–Z)". An invisible sizer
 * span carrying the selected label shares one grid cell with the select and
 * sets the column width; `min-w-0` drops the select's own intrinsic
 * contribution so it fills that width instead of forcing it. The sizer must
 * carry the same padding, border width and type as the select or the chip
 * clips its own text.
 *
 * Accessible: a real `<select>` with an explicit `aria-label` ("Sort by") —
 * native keyboard + screen-reader support (`getByLabel("Sort by")` selectors
 * depend on that name).
 *
 * URL-driven and presentational: owns no state. The value comes from `?sort=`
 * via the route and every change reports through `onChange` — the route's
 * `changeSort` handles the URL navigation, including the "Near me"
 * geolocation opt-in flow.
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
  const selectedLabel = BROWSE_SORT_OPTIONS.find((option) => option.value === value)?.label ?? "";

  return (
    <div className="relative inline-grid shrink-0 items-center">
      <ArrowUpDown
        className="pointer-events-none absolute left-3 size-4 text-brand"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <select
        value={value}
        onChange={(event) => onChange(parseBrowseSort(event.target.value))}
        aria-label="Sort by"
        className="col-start-1 row-start-1 w-full min-w-0 cursor-pointer appearance-none rounded-chip border border-border bg-surface py-2 pl-9 pr-3 text-body-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {BROWSE_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {/* Width sizer only: hidden from the accessibility tree, and `invisible`
          rather than `hidden` so it still occupies the grid cell. */}
      <span
        aria-hidden="true"
        className="pointer-events-none invisible col-start-1 row-start-1 whitespace-nowrap border border-transparent py-2 pl-9 pr-3 text-body-sm font-semibold"
      >
        {selectedLabel}
      </span>
    </div>
  );
}
