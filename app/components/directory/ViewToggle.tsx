import { List, Map as MapIcon } from "lucide-react";

/** The two directory content modes. */
export type DirectoryView = "list" | "map";

/**
 * List/Map segmented control (AUB-61, Phase 2b).
 *
 * ACCESSIBLE: a `role="group"` of two `<button>`s carrying `aria-pressed`, so the
 * active view is announced (state never rests on the pill fill alone). Selecting
 * a segment swaps the content view instantly (no shimmer).
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: DirectoryView;
  onChange: (next: DirectoryView) => void;
}) {
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-chip border-0 bg-muted p-0.5">
      <legend className="sr-only">Choose list or map view</legend>
      <SegmentButton
        active={view === "list"}
        onClick={() => onChange("list")}
        Icon={List}
        label="List"
      />
      <SegmentButton
        active={view === "map"}
        onClick={() => onChange("map")}
        Icon={MapIcon}
        label="Map"
      />
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
