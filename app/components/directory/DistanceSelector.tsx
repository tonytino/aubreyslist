import { MapPin } from "lucide-react";
import { DISTANCE_RADIUS_OPTIONS } from "~/listings/distance";

/**
 * Distance-radius selector (user feedback #7).
 *
 * Sits where the "N places near Denver" count used to be and lets the visitor
 * narrow the directory to listings within a chosen radius of an origin. The
 * origin defaults to Denver Union Station ("Union Station") when we don't have
 * the user's geolocation, and reads as "your location" once we do — the label is
 * supplied by the caller so this component stays presentation-only.
 *
 * ACCESSIBLE: a real, labelled `<select>` (native keyboard + screen-reader
 * support for free). The visible text reads "Within {value} mi of {originLabel}";
 * a visually-hidden `<label>` gives the control an explicit "Search radius" name
 * so it is never an unlabelled mystery target.
 *
 * TRUST MODEL: this is a GEOGRAPHIC filter, deliberately styled with the neutral
 * directory chip language (pin + border + surface) — NOT any `SafetySignal`
 * treatment. Distance is a matter of convenience, never a safety signal, so it
 * must not borrow the celiac-safe / incident colour + icon vocabulary.
 */
export function DistanceSelector({
  value,
  onChange,
  originLabel,
}: {
  /** The selected radius in miles (one of {@link DISTANCE_RADIUS_OPTIONS}). */
  value: number;
  /** Called with the newly-chosen radius (miles) when the selection changes. */
  onChange: (miles: number) => void;
  /** Human label for the origin, e.g. "Union Station" or "your location". */
  originLabel: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-chip border border-border bg-surface px-3 py-2 text-body-sm font-semibold text-foreground focus-within:ring-2 focus-within:ring-brand-ring">
      <MapPin className="size-4 text-brand" strokeWidth={2.25} aria-hidden="true" />
      <span className="sr-only">Search radius</span>
      <span aria-hidden="true">Within</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Search radius"
        className="cursor-pointer appearance-none bg-transparent font-semibold text-brand-strong focus-visible:outline-none"
      >
        {DISTANCE_RADIUS_OPTIONS.map((miles) => (
          <option key={miles} value={miles}>
            {miles} mi
          </option>
        ))}
      </select>
      <span aria-hidden="true">
        of <span className="text-brand-strong">{originLabel}</span>
      </span>
    </label>
  );
}
