import { MapPin, Search, ShieldCheck } from "lucide-react";

/**
 * The directory's non-list content states (AUB-61, Phase 2b): the first-run empty
 * state and the no-results state. The route renders EXACTLY ONE of these (or the
 * list) at a time. (Loading skeletons were retired when the quick chips became a
 * server-side filter — AUB-135 — so filtering pends via the loader like every
 * other server param, with no artificial shimmer.)
 */

/** Shared centred layout for the empty / no-results messages. */
function CenteredState({
  icon,
  iconWrapClass,
  headline,
  body,
  action,
}: {
  icon: React.ReactNode;
  iconWrapClass: string;
  headline: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className={`flex size-[84px] items-center justify-center rounded-full ${iconWrapClass}`}>
        {icon}
      </div>
      <h2 className="font-display text-title font-bold text-foreground">{headline}</h2>
      <p className="max-w-xs text-body text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/**
 * First-run empty state (no query, no filters, but zero results). Offers a
 * "Browse celiac-safe spots" CTA that applies the celiac quick filter.
 */
export function DirectoryEmpty({ onBrowseCeliac }: { onBrowseCeliac: () => void }) {
  return (
    <CenteredState
      iconWrapClass="bg-brand-soft"
      icon={<MapPin className="size-9 text-brand" strokeWidth={2} aria-hidden="true" />}
      headline="Let's find your safe table in Denver"
      body="Search a restaurant by name or address — or browse celiac-safe spots verified by the community."
      action={
        <button
          type="button"
          onClick={onBrowseCeliac}
          className="inline-flex items-center gap-2 rounded-chip bg-brand px-5 py-2.5 text-body-sm font-bold text-brand-foreground shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          <ShieldCheck className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Browse celiac-safe spots
        </button>
      }
    />
  );
}

/**
 * No-results state (a query and/or filters are active, but nothing matched).
 * Offers a "Clear all filters" CTA that resets the query + client + server
 * filters.
 */
export function DirectoryNoResults({ onClearAll }: { onClearAll: () => void }) {
  return (
    <CenteredState
      iconWrapClass="bg-muted"
      icon={<Search className="size-9 text-muted-foreground" strokeWidth={2} aria-hidden="true" />}
      headline="No spots match those filters"
      body="Try removing a filter or searching a nearby neighborhood — the map covers all of metro Denver."
      action={
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center gap-2 rounded-chip border border-brand px-5 py-2.5 text-body-sm font-bold text-brand-strong transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          Clear all filters
        </button>
      }
    />
  );
}
