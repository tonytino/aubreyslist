import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { IncidentReports, incidentsQueryKey } from "~/components/listing/IncidentReports";
import { RecentIncidentBanner } from "~/components/listing/RecentIncidentBanner";
import { SafetySummary } from "~/components/listing/SafetySummary";
import { TrustPlaceholder } from "~/components/listing/TrustPlaceholder";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";
import { getCurrentUser } from "~/server/auth/current-user";
import { fetchIncidents, findRecentIncident } from "~/server/incidents";

/**
 * Server-only loader for a single listing by id. Validated input (the dynamic
 * `$id` segment), so a malformed id is rejected before it reaches the DB.
 * Returns `null` for a non-existent id; the route loader turns that into a
 * `notFound()` so the not-found UI renders (rather than crashing or 500-ing).
 */
const getListing = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }): Promise<Listing | null> => {
    const listing = await getDb().query.listings.findFirst({
      where: eq(listings.id, id),
    });
    return listing ?? null;
  });

/**
 * Whether the visitor is signed in — gates the incident submission form (UX
 * only; the write itself is re-gated server-side in `reportIncident`).
 */
const getViewerIsSignedIn = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => (await getCurrentUser()) !== null
);

/** Cached incident list for a listing — invalidated after a report is filed. */
function incidentsQueryOptions(listingId: string) {
  return queryOptions({
    queryKey: incidentsQueryKey(listingId),
    queryFn: () => fetchIncidents({ data: { listingId } }),
  });
}

export const Route = createFileRoute("/listings/$id")({
  loader: async ({ params: { id }, context }) => {
    const [listing, isSignedIn] = await Promise.all([
      getListing({ data: { id } }),
      getViewerIsSignedIn(),
      // Prefetch incidents so the list + banner render on first paint, then are
      // refetchable client-side via TanStack Query after a new report.
      context.queryClient.ensureQueryData(incidentsQueryOptions(id)),
    ]);
    // A missing listing is a 404, not an error — surface the route's
    // notFoundComponent instead of the error boundary.
    if (!listing) {
      throw notFound();
    }
    return { listing, isSignedIn };
  },
  component: ListingDetail,
  notFoundComponent: ListingNotFound,
});

function ListingDetail() {
  const { listing, isSignedIn } = Route.useLoaderData();
  const { data: incidents } = useSuspenseQuery(incidentsQueryOptions(listing.id));
  // Recent harm flags the listing regardless of older confirmations (ADR-007).
  const recentIncident = findRecentIncident(incidents);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-section bg-background px-4 py-10 text-foreground sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight">{listing.name}</h1>
        <p className="text-body text-muted-foreground">{listing.address}</p>
      </header>

      {/* Recent harm is surfaced first and never buried by older confirmations
          (ADR-007, domain.md → Trust Model). Reusable for the #33 list-card signal. */}
      {recentIncident ? <RecentIncidentBanner occurredOn={recentIncident.occurredOn} /> : null}

      {/* Headline celiac-safe vs gluten-friendly cue (placeholder until EPIC 4). */}
      <SafetySummary state={null} />

      {/* Primary action: deep-link to Google Maps (ADR-009 — no embedded map). */}
      <section aria-label="Links" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          href={listing.mapsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center justify-center gap-2 rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
        >
          <MapPinIcon />
          Open in Google Maps
        </a>

        {listing.menuUrl ? (
          <a
            href={listing.menuUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-2 rounded-card border border-border px-5 py-2.5 text-body font-semibold text-foreground hover:bg-surface"
          >
            View menu
          </a>
        ) : null}
      </section>

      {/* EPIC 4 (#28/#29) slots — honest empty states, never fake data. */}
      <TrustPlaceholder
        title="Community claims"
        description="Confirmed and disputed claims about this restaurant — dedicated fryer, cross-contamination protocol, GF menu, and more — will appear here once the community starts attesting."
      />

      <TrustPlaceholder
        title="Incident reports"
        description="Recent “got glutened here” reports are shown here, most recent first. Recent ones flag the listing at the top of the page regardless of older confirmations."
      >
        <IncidentReports listingId={listing.id} incidents={incidents} isSignedIn={isSignedIn} />
      </TrustPlaceholder>
    </article>
  );
}

/** Inline Google-Maps-style pin glyph (decorative — the label carries meaning). */
function MapPinIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** Not-found UI for an unknown listing id (404-style, scoped to this route). */
function ListingNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16 text-foreground sm:px-6">
      <h1 className="text-headline font-bold tracking-tight">Listing not found</h1>
      <p className="text-body text-muted-foreground">
        We couldn’t find a restaurant for that link. It may have been removed, or the link may be
        incorrect.
      </p>
      <Link to="/" className="text-body-sm underline underline-offset-4">
        Back to home
      </Link>
    </main>
  );
}
