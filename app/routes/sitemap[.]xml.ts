import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";
import { absoluteUrl } from "~/lib/seo";

/**
 * Dynamic `/sitemap.xml` (AUB-161).
 *
 * A TanStack Start **Server Route** (not a page) — file-name escaping
 * (`sitemap[.]xml.ts`) maps to the literal path `/sitemap.xml` (see
 * `docs/agents/routing.md`; the bracket escapes the dot so the router treats it
 * as one path segment rather than a nested `.xml` route). Implemented as its
 * own route file (rather than a `app/server/index.ts` Hono mount) so it doesn't
 * touch the Hono app entry, which is owned by a parallel work item.
 *
 * Lists every PUBLICLY reachable URL so search engines can discover listing
 * detail pages without crawling the SPA:
 *   - the static public marketing pages (`/`, `/about`);
 *   - every listing detail page (`/listings/$id`) for a listing whose
 *     `moderationStatus` is `visible` — the exact idiom the public browse/detail
 *     reads use (see `getListing` in `app/server/listings/get-listing.ts` and
 *     `browse.ts`'s `visibleListing`) so a hidden/removed listing, which 404s for
 *     a direct visitor, is never advertised to a crawler either.
 *
 * Deliberately excludes auth-gated/admin routes (`/favorites`, `/listings/new`,
 * `/admin`) — none of those are indexable by an anonymous crawler anyway, since
 * they either require a session or mutate data.
 *
 * No caching headers are set: sitemap crawls are infrequent and this query is
 * a single `WHERE moderation_status = 'visible'` scan over a pilot-scale table
 * (no index today — fine at this cardinality), so a fresh read per request is
 * cheap and always correct (a listing hidden a second ago is never a stale
 * hit). If the table ever approaches the sitemap-protocol cap (50k URLs per
 * file), split into a sitemap index — tracked as a non-goal for v1.
 */

/** Static, publicly-indexable pages outside the listing-detail set. */
const STATIC_PATHS = ["/", "/about"];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string): string {
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
}

/** Ids of every publicly-visible listing, in the browse/detail idiom (#41). */
async function getVisibleListingIds(): Promise<string[]> {
  const rows = await getDb().query.listings.findMany({
    columns: { id: true },
    where: eq(listings.moderationStatus, "visible"),
  });
  return rows.map((row) => row.id);
}

/** Builds the full sitemap XML document. Exported for the route's test. */
export async function buildSitemapXml(): Promise<string> {
  const listingIds = await getVisibleListingIds();
  const paths = [...STATIC_PATHS, ...listingIds.map((id) => `/listings/${id}`)];
  const locs = paths.map(absoluteUrl);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map(urlEntry),
    "</urlset>",
    "",
  ].join("\n");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const xml = await buildSitemapXml();
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
