import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CommunityClaims, claimsQueryKey } from "~/components/listing/CommunityClaims";
import { IncidentReports, incidentsQueryKey } from "~/components/listing/IncidentReports";
import { RecentIncidentBanner } from "~/components/listing/RecentIncidentBanner";
import { SafetySummary } from "~/components/listing/SafetySummary";
import { TrustPlaceholder } from "~/components/listing/TrustPlaceholder";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";
import { getListingClaimAggregates } from "~/server/attestations/listing-summary";
import { getCurrentUser } from "~/server/auth/current-user";
import { fetchIncidents } from "~/server/incidents/incidents.fn";
import { isHttpUrl } from "~/server/listings/url";
import { getSetting } from "~/server/settings";
import { findRecentIncident } from "~/trust/incident-recency";
import { deriveHeadlineSafetyState } from "~/trust/summary";

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
 * Server-only loader for a listing's claims WITH their aggregates (confirm/
 * dispute counts + recency) in one batched query — the transparent trust
 * roll-up the detail page renders (#29, ADR-007). Reads are open/anonymous.
 */
const getListingClaims = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(({ data: { id } }) => getListingClaimAggregates({ listingId: id }));

/**
 * Server-only read of the admin-tunable staleness window (ADR-007). Read here so
 * the staleness flag on the headline cue + each claim's roll-up reflects the
 * configured `staleness_months` AppSetting rather than a hard-coded default;
 * {@link getSetting} falls back to the in-code default on an unset/corrupt row.
 */
const getStalenessMonths = createServerFn({ method: "GET" }).handler(() =>
  getSetting("staleness_months")
);

/**
 * The current viewer's user id, or `null` when anonymous. Drives both the
 * incident submission form gate (UX) and the OWNER-ONLY edit/retract controls on
 * the viewer's own incidents (#32). The controls are UX only — the edit/retract
 * writes are re-gated AND ownership-checked server-side in `editIncident` /
 * `retractIncident`, so hiding a button is never the actual access control.
 */
const getViewerId = createServerFn({ method: "GET" }).handler(
  async (): Promise<string | null> => (await getCurrentUser())?.id ?? null
);

/** Cached incident list for a listing — invalidated after a report is filed. */
function incidentsQueryOptions(listingId: string) {
  return queryOptions({
    queryKey: incidentsQueryKey(listingId),
    queryFn: () => fetchIncidents({ data: { listingId } }),
  });
}

/**
 * Cached claim roll-up for a listing — invalidated after the viewer changes or
 * retracts their own attestation (#32), so the per-claim counts, recency, the
 * viewer's own vote, and the headline cue all recompute from fresh evidence.
 */
function claimsQueryOptions(listingId: string) {
  return queryOptions({
    queryKey: claimsQueryKey(listingId),
    queryFn: () => getListingClaims({ data: { id: listingId } }),
  });
}

export const Route = createFileRoute("/listings/$id")({
  loader: async ({ params: { id }, context }) => {
    const [listing, viewerId] = await Promise.all([
      getListing({ data: { id } }),
      getViewerId(),
      // Prefetch incidents so the list + banner render on first paint, then are
      // refetchable client-side via TanStack Query after a new report.
      context.queryClient.ensureQueryData(incidentsQueryOptions(id)),
    ]);
    // A missing listing is a 404, not an error — surface the route's
    // notFoundComponent instead of the error boundary.
    if (!listing) {
      throw notFound();
    }
    // Only fetch the trust roll-up once we know the listing exists (#29).
    // Prefetch the claims query too so the roll-up renders on first paint and is
    // refetchable client-side after the viewer changes/retracts a vote (#32).
    const [, stalenessMonths] = await Promise.all([
      context.queryClient.ensureQueryData(claimsQueryOptions(id)),
      getStalenessMonths(),
    ]);
    // Resolve "now" ONCE on the server and pass it down as epoch ms, so the
    // recency window + relative phrasing use the same instant on SSR and after
    // hydration — no banner flicker or off-by-one at day/window edges.
    return { listing, viewerId, stalenessMonths, nowMs: Date.now() };
  },
  component: ListingDetail,
  notFoundComponent: ListingNotFound,
});

function ListingDetail() {
  const { listing, viewerId, stalenessMonths, nowMs } = Route.useLoaderData();
  const { data: incidents } = useSuspenseQuery(incidentsQueryOptions(listing.id));
  const { data: claims } = useSuspenseQuery(claimsQueryOptions(listing.id));
  const now = new Date(nowMs);
  // Recent harm flags the listing regardless of older confirmations (ADR-007).
  const recentIncident = findRecentIncident(incidents, now);

  // Headline celiac-safe vs gluten-friendly cue, derived from the
  // `celiac_safe_vs_gluten_friendly` claim's VISIBLE aggregate (#29, ADR-007).
  // No such claim / no attestation evidence → `null`, so SafetySummary keeps
  // its honest "Not yet attested" empty state (never a fabricated rating).
  const headlineClaim = claims.find(
    (claim) => claim.attribute === "celiac_safe_vs_gluten_friendly"
  );
  const safetyState = headlineClaim
    ? deriveHeadlineSafetyState(headlineClaim, new Date(), stalenessMonths)
    : null;

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-section bg-background px-4 py-10 text-foreground sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight">{listing.name}</h1>
        <p className="text-body text-muted-foreground">{listing.address}</p>
      </header>

      {/* Recent harm is surfaced first and never buried by older confirmations
          (ADR-007, domain.md → Trust Model). Reusable for the #33 list-card signal. */}
      {recentIncident ? (
        <RecentIncidentBanner occurredOn={recentIncident.occurredOn} nowMs={nowMs} />
      ) : null}

      {/* Headline celiac-safe vs gluten-friendly cue, derived from visible evidence (#29). */}
      <SafetySummary state={safetyState} />

      {/* Primary action: deep-link to Google Maps (ADR-009 — no embedded map).
          Both hrefs are guarded by `isHttpUrl` so only http(s) links ever reach
          an anchor — defence-in-depth against a dangerous-scheme URL (#90). The
          mapsUrl is app-generated (lower risk) but the sink is guarded too. */}
      <section aria-label="Links" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {isHttpUrl(listing.mapsUrl) ? (
          <a
            href={listing.mapsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-2 rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
          >
            <MapPinIcon />
            Open in Google Maps
          </a>
        ) : null}

        {isHttpUrl(listing.menuUrl) ? (
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

      {/* EPIC 4 slots — honest empty states, never fake data. */}
      {claims.length > 0 ? (
        // Real, transparent trust roll-up — confirm/dispute counts + recency,
        // all derived from visible evidence (#29, ADR-007).
        <section aria-labelledby="community-claims-heading" className="flex flex-col gap-3">
          <h2 id="community-claims-heading" className="text-title">
            Community claims
          </h2>
          <p className="text-body-sm text-muted-foreground">
            What the community has confirmed or disputed about this restaurant. Each summary is a
            roll-up of the visible attestations below it — never a hidden score.
          </p>
          <CommunityClaims
            listingId={listing.id}
            claims={claims}
            viewerId={viewerId}
            stalenessMonths={stalenessMonths}
          />
        </section>
      ) : (
        <TrustPlaceholder
          title="Community claims"
          description="Confirmed and disputed claims about this restaurant — dedicated fryer, cross-contamination protocol, GF menu, and more — will appear here once the community starts attesting."
        />
      )}

      <TrustPlaceholder
        title="Incident reports"
        description="Recent “got glutened here” reports are shown here, most recent first. Recent ones flag the listing at the top of the page regardless of older confirmations."
      >
        <IncidentReports listingId={listing.id} incidents={incidents} viewerId={viewerId} />
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
