import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { z } from "zod";
import { ClaimBadge } from "~/components/listing/ClaimBadge";
import { ClaimDeckSection } from "~/components/listing/ClaimDeckSection";
import { CommunityClaims, claimsQueryKey } from "~/components/listing/CommunityClaims";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import { FlagControl } from "~/components/listing/FlagControl";
import { HeroPhoto } from "~/components/listing/HeroPhoto";
import { HeroTrustBar } from "~/components/listing/HeroTrustBar";
import { IncidentReports, incidentsQueryKey } from "~/components/listing/IncidentReports";
import { ListingLinks, listingLinksQueryKey } from "~/components/listing/ListingLinks";
import { ListingMap } from "~/components/listing/ListingMap";
import { RecentIncidentBanner } from "~/components/listing/RecentIncidentBanner";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { absoluteUrl, breadcrumbJsonLd, canonicalLink, jsonLdScript, pageSeoMeta } from "~/lib/seo";
import {
  LISTING_DETAIL_SEARCH_DEFAULTS,
  type ListingDetailTab,
  listingDetailSearchSchema,
} from "~/listings/listing-detail-search";
import { useListingPreview } from "~/listings/photo-preview-state";
import { getListingClaimAggregates } from "~/server/attestations/listing-summary";
import { getCurrentUser } from "~/server/auth/current-user";
import { fetchIncidents } from "~/server/incidents/incidents.fn";
import { fetchListingLinks } from "~/server/listing-links/links.fn";
import { getListingActivity } from "~/server/listings/activity";
import { fetchListing } from "~/server/listings/get-listing.fn";
import { isHttpUrl } from "~/server/listings/url";
import { getSetting } from "~/server/settings";
import { deriveHeroClaimChips } from "~/trust/hero-chips";
import { findRecentIncident } from "~/trust/incident-recency";
import { deriveHeadlineSafetyState, deriveListingActivityMeta } from "~/trust/summary";

/**
 * Server-only loader for a listing's claims with their aggregates (confirm/
 * dispute counts + recency) in one batched query — the transparent trust
 * roll-up the detail page renders (ADR-007) — plus the listing's activity pair
 * (last attestation instant + happy patrons) behind the hero's meta strip.
 * Reads are open/anonymous.
 *
 * The two travel together so one invalidation after a vote refreshes both: a
 * viewer who just confirmed a claim sees the counts AND the "Updated just now"
 * line move in the same paint, instead of an activity line stuck at its
 * page-load value.
 */
const getListingClaims = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const [claims, activity] = await Promise.all([
      getListingClaimAggregates({ listingId: id }),
      getListingActivity(id),
    ]);
    return { claims, activity };
  });

/**
 * Server-only read of the admin-tunable staleness window (ADR-007), so the
 * staleness flag on the headline cue + each claim's roll-up reflects the
 * configured `staleness_months` AppSetting rather than a hard-coded default.
 * {@link getSetting} falls back to the in-code default on an unset/corrupt
 * row.
 */
const getStalenessMonths = createServerFn({ method: "GET" }).handler(() =>
  getSetting("staleness_months")
);

/**
 * The current viewer's user id, or `null` when anonymous. Drives the incident
 * submission form gate and the owner-only edit/retract controls on the
 * viewer's own incidents. The controls are UX only — the writes are re-gated
 * and ownership-checked server-side, so hiding a button is never the actual
 * access control.
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
 * Cached typed links for a listing — invalidated after a signed-in viewer
 * saves or removes a link via the edit-links dialog.
 */
function listingLinksQueryOptions(listingId: string) {
  return queryOptions({
    queryKey: listingLinksQueryKey(listingId),
    queryFn: () => fetchListingLinks({ data: { listingId } }),
  });
}

/**
 * Cached claim roll-up for a listing — invalidated after the viewer changes
 * or retracts their own attestation, so the per-claim counts, recency, the
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
      // Prefetch the typed links so the Links section renders on first paint
      // and is refetchable client-side after an edit-links save.
      context.queryClient.ensureQueryData(listingLinksQueryOptions(id)),
    ]);
    // A missing listing is a 404, not an error — surface the route's
    // notFoundComponent instead of the error boundary.
    if (!listing) {
      throw notFound();
    }
    // Only fetch the trust roll-up once the listing is known to exist.
    // Prefetch the claims query so the roll-up renders on first paint and is
    // refetchable client-side after the viewer changes/retracts a vote.
    const [, stalenessMonths] = await Promise.all([
      context.queryClient.ensureQueryData(claimsQueryOptions(id)),
      getStalenessMonths(),
    ]);
    // Resolve "now" once on the server and pass it down as epoch ms, so the
    // recency window + relative phrasing use the same instant on SSR and
    // after hydration — no banner flicker or off-by-one at window edges.
    return { listing, viewerId, stalenessMonths, nowMs: Date.now() };
  },
  // Per-listing SEO + social unfurl — the high-value share case. Guarded: on
  // a 404 the loader throws `notFound()` and never returns, so `loaderData`
  // is undefined here — fall back to the root defaults. Uses only fields the
  // listing actually has — no invented ratings/prices/phone. The `Restaurant`
  // JSON-LD is honest structured data serialized via `jsonLdScript`.
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
        // Breadcrumb trail (Home → this restaurant) so Search can render the
        // page's place in the site instead of the raw URL path.
        jsonLdScript(
          breadcrumbJsonLd([
            { name: "Aubrey's List", path: "/" },
            { name: listing.name, path },
          ])
        ),
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
  const { data: claimsData } = useSuspenseQuery(claimsQueryOptions(listing.id));
  const { claims, activity } = claimsData;
  const { data: linksData } = useSuspenseQuery(listingLinksQueryOptions(listing.id));
  const preview = useListingPreview();
  const now = new Date(nowMs);
  const isSignedIn = viewerId !== null;
  // Recent harm flags the listing regardless of older confirmations (ADR-007).
  const recentIncident = findRecentIncident(incidents, now);

  // Headline celiac-safe cue, derived from the `celiac_safe`
  // claim's visible aggregate (ADR-007). No such claim, no attestation
  // evidence, or a dispute majority → `null`, so SafetySummary shows honest
  // guidance and no badge (never a fabricated rating).
  const headlineClaim = claims.find((claim) => claim.attribute === "celiac_safe");
  const safetyState = headlineClaim
    ? deriveHeadlineSafetyState(headlineClaim, now, stalenessMonths)
    : null;

  // The hero's meta strip, mirrored from the browse card through the shared
  // pure seam so the two surfaces phrase activity identically. Deliberately
  // NOT gated on the headline verdict (owner decision 2026-08-25): it reports
  // claim activity, not a verification, and the line says so in its tooltip.
  // The badge suppression above is untouched — a contested listing still earns
  // no badge and no confirmation-derived reassurance.
  const activityMeta = deriveListingActivityMeta(activity, now);

  // The hero's claim chips — confirmed non-headline attributes, then live bot
  // suggestions (the headline included, which is the one state where it earns
  // a chip: the hero renders nothing for a suggestion). Evidence before
  // provenance, the browse card's order, through the same shared `ClaimBadge`,
  // so the two surfaces read identically for the same listing. The rule itself
  // lives in the pure `deriveHeroClaimChips`, pinned against the card's glance.
  const heroClaimBadges = deriveHeroClaimChips(claims);

  const claimsCount = claims.length;
  const incidentsCount = incidents.length;

  const handleTabChange = (value: string) => {
    // Tab is client-only view state — it changes no server input, so only the
    // `?tab=` param is rewritten; no loaderDeps, no page reset.
    // `resetScroll: false` because the evidence panel sits well below the
    // hero and TanStack Router resets scroll to top on navigation by default
    // — without this, switching tabs yanks a mobile viewer back up to the
    // hero on every tap.
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
            photo layered on top when one resolves (ADR-014 — fetched per view
            through the server-side proxy, never persisted). Decorative pastel
            blobs over a brand gradient stay the loading/fallback/error state;
            a bottom scrim keeps the overlaid white name/address AA-legible
            over either surface. All Tailwind utilities — no inline styles. */}
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
              listing B's photo. `preview` (consumed once from router state —
              absent on a direct visit/refresh) lets the hero blur-up from the
              card's already-cached photo instead of starting blank. */}
          <HeroPhoto key={listing.id} listingId={listing.id} preview={preview} />
          {/* Bottom scrim for text contrast. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
          />

          {/* Top-right circular icon actions: favorite (wired) + flag. */}
          <div className="absolute right-3 top-3 z-30 flex gap-2">
            {/* Save/favorite affordance. Reads `["favorites"]` +
                `currentUserQuery` itself (both prefetched at the root), so it
                needs no loader wiring and handles its own anon (dialog) vs
                signed-in (optimistic toggle) behaviour. Styled with the hero
                overlay chrome to match the sibling flag icon button. */}
            <FavoriteButton
              listingId={listing.id}
              listingName={listing.name}
              className={HERO_ICON_BUTTON}
            />
            {/* Flag this listing as an icon + tooltip. FlagControl keeps its
                login gate (renders nothing when anonymous) and the server
                re-gates regardless; the reason form opens in a portaled
                dialog. */}
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

        {/* Solid bar below the media: the safety verdict, then the activity
            strip in its own fixed slot. `HeroTrustBar` owns that stacking, so
            the strip reads as the same row in the same place whichever badge,
            prose, or combination the verdict renders. */}
        <HeroTrustBar
          safetyState={safetyState}
          hasRecentIncident={recentIncident !== null}
          activity={activityMeta}
        />

        {/* Claim chips: a second row, so every confirmed attribute and every
            live bot suggestion is visible at a glance instead of buried in the
            Claims tab below. */}
        {heroClaimBadges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-card pb-card pt-3">
            {heroClaimBadges.map((claim) => (
              <ClaimBadge
                key={claim.attribute}
                attribute={claim.attribute}
                suggested={claim.suggested}
              />
            ))}
          </div>
        ) : null}
      </header>

      {/* Recent harm is surfaced first and never buried by older
          confirmations (ADR-007). It stays above the tabs — never hidden
          behind a tab. */}
      {recentIncident ? (
        <RecentIncidentBanner occurredOn={recentIncident.occurredOn} nowMs={nowMs} />
      ) : null}

      {/* Embedded map preview (ADR-014). Renders nothing when the public
          browser key is unset (no empty block, no layout shift).
          Deliberately a sibling of the "Links" region below, never inside
          it: the edit-listing-links E2E spec asserts link/button roles
          within that region, and the map must not perturb them. The "Open in
          Google Maps" deep-link inside ListingLinks stays — it is the mobile
          hand-off to turn-by-turn in the native Maps app; the embed is only
          a preview. */}
      <ListingMap name={listing.name} address={listing.address} placeId={listing.placeId} />

      {/* Links: the Google Maps deep-link plus the listing's typed links in
          LINK_KINDS order, with the legacy menuUrl as the menu fallback and —
          for signed-in viewers — the wiki-style edit-links dialog. Every href
          is `isHttpUrl`-guarded at the render sink inside the component. Both
          the typed links and the legacy fallback come from the invalidatable
          links query (not the loader's listing row), so an edit that clears
          the legacy column refreshes the section without a full route
          reload. */}
      <ListingLinks
        listingId={listing.id}
        mapsUrl={listing.mapsUrl}
        legacyMenuUrl={linksData.legacyMenuUrl}
        links={linksData.links}
        isSignedIn={isSignedIn}
      />

      {/* Tabbed evidence panel: Community claims + Incident reports in one
          card, with short "Claims" / "Reports" trigger labels (the count
          chips + context keep the surface unambiguous on mobile, where the
          grid-cols-2 TabsList is cramped for longer text). The active tab is
          URL-backed (`?tab=`) so it is shareable and survives
          refresh/back-forward. The shadcn Tabs primitive handles
          role=tab/tabpanel + arrow-key roving focus. Community claims always
          render the full fixed taxonomy as attestable, with honest empty
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
                {/* The swipeable attest deck's CTA — signed-in only;
                    anonymous viewers keep the sign-in prompts below. Writes
                    go through the same submitVote/removeVote seam as the
                    inline toggles, so everything on this page refreshes. */}
                <ClaimDeckSection listingId={listing.id} claims={claims} isSignedIn={isSignedIn} />
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
