import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CircleCheck, MapPin, Menu, Users } from "lucide-react";
import { z } from "zod";
import { CommunityClaims, claimsQueryKey } from "~/components/listing/CommunityClaims";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import { FlagControl } from "~/components/listing/FlagControl";
import { HeroPhoto } from "~/components/listing/HeroPhoto";
import { IncidentReports, incidentsQueryKey } from "~/components/listing/IncidentReports";
import { RecentIncidentBanner } from "~/components/listing/RecentIncidentBanner";
import { SafetySummary } from "~/components/listing/SafetySummary";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { absoluteUrl, canonicalLink, jsonLdScript, pageSeoMeta } from "~/lib/seo";
import {
  LISTING_DETAIL_SEARCH_DEFAULTS,
  type ListingDetailTab,
  listingDetailSearchSchema,
} from "~/listings/listing-detail-search";
import { getListingClaimAggregates } from "~/server/attestations/listing-summary";
import { getCurrentUser } from "~/server/auth/current-user";
import { fetchIncidents } from "~/server/incidents/incidents.fn";
import { fetchListing } from "~/server/listings/get-listing.fn";
import { isHttpUrl } from "~/server/listings/url";
import { getSetting } from "~/server/settings";
import { findRecentIncident } from "~/trust/incident-recency";
import { deriveHeadlineSafetyState, formatRelativeTime } from "~/trust/summary";

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
  // Which evidence tab is open is shareable/restorable state, so it lives in the
  // URL as a validated `?tab=` param (Hard Rule → "selected tab"). The default
  // tab is stripped from the bar so a bare listing URL stays clean.
  validateSearch: listingDetailSearchSchema,
  search: { middlewares: [stripSearchParams(LISTING_DETAIL_SEARCH_DEFAULTS)] },
  loader: async ({ params: { id }, context }) => {
    const [listing, viewerId] = await Promise.all([
      fetchListing({ data: { id } }),
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
  // Per-listing SEO + social unfurl — the high-value share case (a specific
  // restaurant). Guarded: on a 404 the loader throws `notFound()` and never
  // returns, so `loaderData` is undefined here — fall back to the root defaults.
  // Uses ONLY fields the listing actually has (name, address, geo, mapsUrl) — no
  // invented ratings/prices/phone. The `Restaurant` JSON-LD is honest structured
  // data serialized via `jsonLdScript` (escapes `<`).
  head: ({ loaderData }) => {
    const listing = loaderData?.listing;
    if (!listing) {
      return {};
    }
    const path = `/listings/${listing.id}`;
    return {
      meta: pageSeoMeta({
        title: `${listing.name} · Aubrey's List`,
        description: `${listing.name}, ${listing.address}. See what the community has attested about its safety for gluten-free and celiac diners.`,
        path,
      }),
      links: [canonicalLink(path)],
      scripts: [
        jsonLdScript({
          "@context": "https://schema.org",
          "@type": "Restaurant",
          name: listing.name,
          address: listing.address,
          geo: {
            "@type": "GeoCoordinates",
            latitude: listing.lat,
            longitude: listing.lng,
          },
          url: absoluteUrl(path),
          ...(isHttpUrl(listing.mapsUrl) ? { hasMap: listing.mapsUrl } : {}),
        }),
      ],
    };
  },
  component: ListingDetail,
  notFoundComponent: ListingNotFound,
});

/**
 * Circular icon-button chrome for the hero media overlay (favorite + flag). A
 * translucent dark chip with a light border so white glyphs stay AA-legible over
 * the brand gradient + scrim. Motion is limited to a colour transition, disabled
 * under prefers-reduced-motion.
 */
const HERO_ICON_BUTTON =
  "inline-flex size-10 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-0 motion-reduce:transition-none [&_svg]:size-5";

function ListingDetail() {
  const { listing, viewerId, stalenessMonths, nowMs } = Route.useLoaderData();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: incidents } = useSuspenseQuery(incidentsQueryOptions(listing.id));
  const { data: claims } = useSuspenseQuery(claimsQueryOptions(listing.id));
  const now = new Date(nowMs);
  const isSignedIn = viewerId !== null;
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
    ? deriveHeadlineSafetyState(headlineClaim, now, stalenessMonths)
    : null;

  // At-a-glance metadata mirrored from the browse card, derived ONLY from data
  // already in hand (the headline claim's aggregate). HONEST: an item is omitted
  // rather than fabricated when its value isn't available — "Verified …" only when
  // there is a real last-confirmed timestamp, "N confirmations" only when > 0. A
  // distinct-contributor count is not loaded on this route, so it is omitted
  // entirely rather than invented.
  const verifiedRelative = headlineClaim
    ? formatRelativeTime(headlineClaim.lastConfirmedAt, now)
    : null;
  const confirmations = headlineClaim?.confirmCount ?? 0;

  const claimsCount = claims.length;
  const incidentsCount = incidents.length;

  const handleTabChange = (value: string) => {
    // Tab is client-only view state — it changes no server input, so we only
    // rewrite the `?tab=` param and never touch loaderDeps or reset a page index.
    // `resetScroll: false` because the evidence panel sits well below the hero (a
    // control below the fold rewriting a client-only param), and TanStack Router
    // resets scroll to top on navigation by default — without this, switching
    // tabs would yank a mobile viewer back up to the hero on every tap (repo-owner
    // mobile feedback).
    navigate({
      search: (prev) => ({ ...prev, tab: value as ListingDetailTab }),
      resetScroll: false,
    });
  };

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-section bg-background px-4 py-6 text-foreground sm:px-6 sm:py-8">
      {/* ============================================================ HERO */}
      <header className="relative overflow-hidden rounded-card border border-border bg-surface shadow-sm">
        {/* Media band: brand-tinted gradient with a render-time Google Place
            photo layered on top when one resolves (AUB-215, ADR-014 — fetched
            per view through the server-side proxy, never persisted). Decorative
            pastel blobs layer over a brand gradient and stay the loading/
            fallback/error state; a bottom scrim keeps the overlaid white
            name/address AA-legible over either surface. All Tailwind utilities
            — no inline styles. */}
        <div className="relative aspect-[16/9] bg-gradient-to-br from-brand to-brand-strong sm:aspect-[21/9]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(120%_90%_at_12%_18%,var(--color-accent-peach),transparent_55%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(110%_90%_at_88%_12%,var(--color-accent-mint),transparent_50%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(130%_120%_at_78%_96%,var(--color-accent-sky),transparent_55%)]"
          />
          {/* Placeholder label — visible only while no real photo covers it. */}
          <div aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <span className="font-mono text-caption font-semibold uppercase tracking-[0.28em] text-white/80">
              Food photo
            </span>
          </div>
          {/* Render-time place photo + its attribution line (client-side query,
              never blocks render). Renders nothing — leaving the gradient band
              untouched — while loading and on any failure. Sits between the
              gradient layers and the scrim so overlaid text stays legible.
              Keyed by listing id so client-side navigation between listings
              remounts it — a broken image on listing A must never suppress
              listing B's photo. */}
          <HeroPhoto key={listing.id} listingId={listing.id} />
          {/* Bottom scrim for text contrast. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
          />

          {/* Top-right circular icon actions: favorite (wired) + flag. */}
          <div className="absolute right-3 top-3 z-30 flex gap-2">
            {/* Save/favorite affordance (F7, AUB-126) — the shipped, wired island.
                Reads `["favorites"]` + `currentUserQuery` itself (both prefetched at
                the root), so it needs no loader wiring and handles its own anon
                (dialog) vs signed-in (optimistic toggle) behaviour. Styled with the
                hero overlay chrome so it matches the sibling flag icon button. */}
            <FavoriteButton
              listingId={listing.id}
              listingName={listing.name}
              className={HERO_ICON_BUTTON}
            />
            {/* Flag this listing (#39) as an icon + tooltip. FlagControl keeps its
                login gate (renders nothing when anonymous) and the server re-gates
                regardless; the reason form opens in a portaled dialog. */}
            <FlagControl
              target="listing"
              listingId={listing.id}
              isSignedIn={isSignedIn}
              label="Flag listing"
              variant="icon"
              triggerClassName={HERO_ICON_BUTTON}
            />
          </div>

          {/* Name + address overlaid on the scrim (white text, AA via scrim). */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 p-card">
            <h1 className="font-display text-headline font-bold tracking-tight text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.55)] sm:text-display">
              {listing.name}
            </h1>
            <span className="inline-flex items-center gap-1.5 text-body-sm text-white/95 [text-shadow:0_1px_10px_rgba(0,0,0,0.6)]">
              <MapPin aria-hidden="true" className="size-4 shrink-0" />
              {listing.address}
            </span>
          </div>
        </div>

        {/* Solid bar below the media: the ONE safety-badge row for this listing
            (repo-owner feedback, nits-detail-badges-once — the headline state
            used to render twice, once here and once in a standalone
            `SafetyBadges` row below the hero) + the at-a-glance metadata strip
            mirrored from the browse card. `SafetySummary`'s hero variant now
            owns the whole row: the headline celiac-safe/gluten-friendly/stale
            badge (or the honest "Not yet attested" empty state) plus the
            recent-incident badge, scrolling horizontally on overflow rather
            than wrapping. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-card">
          <SafetySummary
            state={safetyState}
            variant="hero"
            hasRecentIncident={recentIncident !== null}
          />
          {verifiedRelative || confirmations > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
              {verifiedRelative ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CircleCheck aria-hidden="true" className="size-4 text-celiac-safe" />
                  Verified {verifiedRelative}
                </span>
              ) : null}
              {confirmations > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Users aria-hidden="true" className="size-4" />
                  {confirmations} confirmation{confirmations === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/* Recent harm is surfaced first and never buried by older confirmations
          (ADR-007). It STAYS above the tabs — never hidden behind a tab. */}
      {recentIncident ? (
        <RecentIncidentBanner occurredOn={recentIncident.occurredOn} nowMs={nowMs} />
      ) : null}

      {/* Primary action: deep-link to Google Maps (ADR-009 — no embedded map).
          Both hrefs are guarded by `isHttpUrl` so only http(s) links ever reach
          an anchor — defence-in-depth against a dangerous-scheme URL (#90). Full-
          width on mobile, side-by-side from 480px. */}
      <section
        aria-label="Links"
        className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center"
      >
        {isHttpUrl(listing.mapsUrl) ? (
          <Button asChild size="lg" className="w-full min-[480px]:w-auto">
            <a href={listing.mapsUrl} target="_blank" rel="noreferrer noopener">
              <MapPin aria-hidden className="h-4 w-4" />
              Open in Google Maps
            </a>
          </Button>
        ) : null}

        {isHttpUrl(listing.menuUrl) ? (
          <Button asChild size="lg" variant="outline" className="w-full min-[480px]:w-auto">
            <a href={listing.menuUrl} target="_blank" rel="noreferrer noopener">
              <Menu aria-hidden className="h-4 w-4" />
              View menu
            </a>
          </Button>
        ) : null}
      </section>

      {/* Tabbed evidence panel (AUB-131): Community claims + Incident reports in
          one card, with short "Claims" / "Reports" trigger labels (the count
          chips + full context make the surface unambiguous even on mobile,
          where the grid-cols-2 TabsList is cramped for longer text). The
          active tab is URL-backed (`?tab=`) so it is shareable and survives
          refresh/back-forward. The shadcn Tabs primitive handles
          role=tab/tabpanel + arrow-key roving focus. Community claims ALWAYS
          render the full fixed taxonomy as attestable (#150), with honest empty
          states — never fabricated data. */}
      <section aria-label="Community evidence">
        <Card>
          <CardContent>
            <Tabs value={tab} onValueChange={handleTabChange}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="claims">
                  Claims
                  <span className="ml-1.5 rounded-chip bg-muted px-1.5 text-caption font-semibold text-muted-foreground">
                    {claimsCount}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="incidents">
                  Reports
                  <span className="ml-1.5 rounded-chip bg-muted px-1.5 text-caption font-semibold text-muted-foreground">
                    {incidentsCount}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="claims" className="pt-4">
                <p className="mb-3 text-body-sm text-muted-foreground">
                  What the community has confirmed or disputed. Each summary is a roll-up of the
                  visible attestations below it, never a hidden score. Sign in to confirm or dispute
                  any attribute.
                </p>
                <CommunityClaims
                  listingId={listing.id}
                  claims={claims}
                  viewerId={viewerId}
                  now={now}
                  stalenessMonths={stalenessMonths}
                />
              </TabsContent>

              <TabsContent value="incidents" className="pt-4">
                <p className="mb-3 text-body-sm text-muted-foreground">
                  Glutened reports, newest first. A recent one flags the listing at the top of the
                  page regardless of older confirmations.
                </p>
                <IncidentReports
                  listingId={listing.id}
                  incidents={incidents}
                  viewerId={viewerId}
                  now={now}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>
    </article>
  );
}

/** Not-found UI for an unknown listing id (404-style, scoped to this route). */
function ListingNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16 text-foreground sm:px-6">
      <h1 className="text-headline font-bold tracking-tight">Listing not found</h1>
      <p className="text-body text-muted-foreground">
        We couldn't find that restaurant. It may have been removed, or the link may be wrong.
      </p>
      <Link to="/" className="text-body-sm underline underline-offset-4">
        Back to home
      </Link>
    </main>
  );
}
