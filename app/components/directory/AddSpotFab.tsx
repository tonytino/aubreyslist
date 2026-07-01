import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

/**
 * Floating "Add a spot" action (AUB-61, Phase 2b). A persistent purple pill,
 * bottom-right, that links to the existing add-listing route (`/listings/new`).
 * Rendered as a {@link Link} so it's a real navigation target (keyboard + screen
 * reader reachable), not a mystery button.
 */
export function AddSpotFab() {
  return (
    <Link
      to="/listings/new"
      className="absolute bottom-5 right-[18px] z-[15] inline-flex items-center gap-1.5 rounded-chip bg-brand px-[18px] py-3.5 text-body-sm font-bold text-brand-foreground shadow-lg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
    >
      <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
      <span>Add a spot</span>
    </Link>
  );
}
