import { MapPin } from "lucide-react";
import { DISTANCE_RADIUS_OPTIONS } from "~/listings/distance";

/**
 * Distance-radius selector: narrows the directory to listings within a chosen
 * radius. The whole control is a single native `<select>` styled as a chip, so
 * clicking anywhere on it opens the options; the visible text reads "Within
 * {value} miles". The origin the radius is measured from (the user's location,
 * or Denver Union Station as a fallback) is applied by the route and
 * deliberately not shown here. The MapPin is a decorative, click-through
 * overlay.
 *
 * Sized to the selected option by `field-sizing: content`, like
 * {@link SortSelector} — see the note there.
 *
 * Accessible: a real `<select>` with an explicit `aria-label` ("Search
 * radius") — native keyboard + screen-reader support, never an unlabelled
 * mystery target.
 *
 * Trust model: a geographic filter, styled with the neutral directory chip
 * language (pin + border + surface) — never any `SafetySignal` treatment.
 * Distance is convenience, not a safety signal.
 */
export function DistanceSelector({
  value,
  onChange,
}: {
  /** The selected radius in miles (one of {@link DISTANCE_RADIUS_OPTIONS}). */
  value: number;
  /** Called with the newly-chosen radius (miles) when the selection changes. */
  onChange: (miles: number) => void;
}) {
  return (
    <div className="relative inline-flex items-center">
      <MapPin
        className="pointer-events-none absolute left-3 size-4 text-brand"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Search radius"
        className="cursor-pointer appearance-none rounded-chip border border-border bg-surface py-2 pl-9 pr-3 text-body-sm font-semibold text-foreground [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {DISTANCE_RADIUS_OPTIONS.map((miles) => (
          <option key={miles} value={miles}>
            Within {miles} miles
          </option>
        ))}
      </select>
    </div>
  );
}
