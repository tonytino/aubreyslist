import { List, Map as MapIcon } from "lucide-react";

/** The two directory content modes. */
export type DirectoryView = "list" | "map";

/**
 * List/Map segmented control (AUB-61, Phase 2b).
 *
 * ACCESSIBLE: a `role="group"` of `<button>`s carrying `aria-pressed`, so the
 * active view is announced (state never rests on the pill fill alone). Selecting
 * a segment swaps the content view instantly (no shimmer).
 *
 * AUB-164: the Map segment is gated behind `mapEnabled` (defaults to `false` —
 * fail-closed) because the current map view is a CSS placeholder with no real
 * map provider wired up (see `DirectoryMap.tsx`); a real provider is deferred to
 * AUB-111. The public directory (`app/routes/index.tsx`) leaves `mapEnabled`
 * unset, so the Map segment stays hidden and visitors can never reach the
 * placeholder. Do NOT delete this component or the Map segment below — AUB-111
 * builds on it directly by passing `mapEnabled` once a real map ships.
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
