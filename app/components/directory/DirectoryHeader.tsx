import { ChevronDown, MapPin, Users } from "lucide-react";

/**
 * Directory toolbar row (AUB-61). The app-shell `SiteHeader` already brands the
 * page, so this row carries only the directory-specific controls and deliberately
 * does NOT render a second wordmark (which would duplicate the "Aubrey's List"
 * header):
 *   - left: a location button "Denver, CO" (pin + chevron),
 *   - right: a round community/profile button.
 *
 * The location and community buttons are present-but-unwired affordances (per the
 * bundle); they carry explicit `aria-label`s so they are honest to assistive tech
 * rather than silent mystery targets.
 */
export function DirectoryHeader() {
  return (
    <div className="flex items-center justify-between gap-2 px-gutter pb-3 pt-4">
      <button
        type="button"
        aria-label="Change location — currently Denver, CO"
        className="inline-flex items-center gap-1.5 rounded-chip px-1 py-1 text-body-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        <MapPin className="size-4 text-brand" strokeWidth={2.25} aria-hidden="true" />
        <span>Denver, CO</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label="Community and profile"
        className="inline-flex size-9 items-center justify-center rounded-full border border-brand-soft bg-brand-soft text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        <Users className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
