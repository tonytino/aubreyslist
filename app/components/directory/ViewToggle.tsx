import { List, Map as MapIcon } from "lucide-react";
import type { DirectoryView } from "~/listings/browse-search";

/** The two directory content modes. Canonical definition: `~/listings/browse-search`. */
export type { DirectoryView };

/**
 * List/Map segmented control (AUB-61, Phase 2b).
 *
 * ACCESSIBLE: a `role="group"` of `<button>`s carrying `aria-pressed`, so the
 * active view is announced (state never rests on the pill fill alone). Selecting
 * a segment swaps the content view instantly (no shimmer).
 *
 * AUB-164 / OWNER OVERRIDE: the Map segment is gated behind `mapEnabled`
 * (defaults to `false` — fail-closed). It was originally hidden while the map
 * view was a bare CSS placeholder; the repo owner then explicitly asked for the
 * Map segment to come back on the public directory, so the directory route
 * (`app/routes/index.tsx`) passes `mapEnabled` and the selected view round-trips
 * through `?view=`. As of AUB-111 the map view renders a REAL Google map when
 * the public `VITE_GOOGLE_MAPS_BROWSER_KEY` is provisioned, and the stylized
 * CSS-placeholder fallback otherwise (see `DirectoryMap.tsx`). `mapEnabled`
 * itself stays available (defaulting to hidden) for any other consumer that
 * isn't ready to show a map. Do NOT delete this component or the Map segment
 * below.
 */
export function ViewToggle({
  view,
  onChange,
  mapEnabled = false,
}: {
  view: DirectoryView;
  onChange: (next: DirectoryView) => void;
  /** Show the Map segment. Defaults to `false`; see the AUB-164 note above. */
  mapEnabled?: boolean;
}) {
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-chip border-0 bg-muted p-0.5">
      <legend className="sr-only">
        {mapEnabled ? "Choose list or map view" : "Directory view"}
      </legend>
      <SegmentButton
        active={view === "list"}
        onClick={() => onChange("list")}
        Icon={List}
        label="List"
      />
      {mapEnabled ? (
        <SegmentButton
          active={view === "map"}
          onClick={() => onChange("map")}
          Icon={MapIcon}
          label="Map"
        />
      ) : null}
    </fieldset>
  );
}

function SegmentButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof List;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
        active
          ? "bg-surface text-brand-strong shadow-sm"
          : "bg-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
