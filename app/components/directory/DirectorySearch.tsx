import { Search, X } from "lucide-react";

/**
 * Full-width directory search field (AUB-61, Phase 2b).
 *
 * Controlled by the route: the route mirrors this input to the URL `?q=` (debounced)
 * so the search runs SERVER-side over name + address across ALL listings — the
 * placeholder promises only what is actually searched (name/address; cuisine +
 * neighborhood are deferred to AUB-112). No loading shimmer — search stays smooth.
 * A clear (✕) button appears only when the query is non-empty.
 *
 * ACCESSIBLE: a real labelled `<input type="search">` (the label is visually
 * hidden but present for screen readers); the leading icon is decorative.
 */
export function DirectorySearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative">
      <label htmlFor="directory-search" className="sr-only">
        Search listings
      </label>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        id="directory-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search restaurants by name or address"
        // The native search input's built-in clear affordance is suppressed so we
        // render our own consistent ✕ (below) across browsers.
        className="w-full rounded-[14px] border-[1.5px] border-border bg-surface px-11 py-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring/40 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 flex size-[26px] -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
