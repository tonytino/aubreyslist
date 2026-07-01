import { MapPin, Search, ShieldCheck } from "lucide-react";

/**
 * The directory's non-list content states (AUB-61, Phase 2b): loading skeletons,
 * the first-run empty state, and the no-results state. The route renders EXACTLY
 * ONE of these (or the list) at a time, per the bundle.
 */

/** Shimmer block: a sliding-gradient fill via the `animate-shimmer` utility. */
const SHIMMER =
  "animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-muted),color-mix(in_oklch,var(--color-muted),white_45%),var(--color-muted))] [background-size:200%_100%]";

/**
 * Loading skeletons — four shimmer cards, shown for the bundle's ~430ms filter
 * shimmer window. The shimmer animation is gated behind `prefers-reduced-motion`
 * in `app.css` (the sliding gradient holds still for opted-out users; the shape
 * still reads as "loading"). The bar widths are constants, so they are plain
 * Tailwind arbitrary utilities (`w-[62%]` …) — no inline styles here.
 */
export function LoadingSkeletons() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-3.5">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <div className={`h-[150px] ${SHIMMER} rounded-none`} />
          <div className="flex flex-col gap-2.5 px-4 py-4">
            <div className={`h-4 w-[62%] ${SHIMMER}`} />
            <div className={`h-3 w-[44%] ${SHIMMER}`} />
            <div className={`mt-1 h-6 w-[38%] ${SHIMMER}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

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
