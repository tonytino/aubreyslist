import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

/**
 * Floating "Add listing" action. A persistent purple pill, bottom-right,
 * that links to the add-listing route (`/listings/new`). Rendered as a
 * {@link Link} so it's a real navigation target (keyboard + screen reader
 * reachable), not a mystery button. Positioned `fixed` to the viewport's
 * bottom-right so it stays pinned there at any scroll position and viewport
 * height, under the directory's natural document scroll, without overlapping the
 * cards.
 *
 * The map carousel's end spacer (`map-ui.tsx`, `w-40`) is sized to this
 * pill's footprint (`right-6` offset + rendered width) so mini-cards can
 * scroll clear of it — retune the two together, the same pairing rule as
 * `CAROUSEL_BAND_PX` and its derived values.
 */
export function AddSpotFab() {
  return (
    <Link
      to="/listings/new"
      className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-1.5 rounded-chip bg-brand px-[18px] py-3.5 text-body-sm font-bold text-brand-foreground shadow-lg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
    >
      <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
      <span>Add listing</span>
    </Link>
  );
}
