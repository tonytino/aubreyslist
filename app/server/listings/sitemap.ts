import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";
import { absoluteUrl } from "~/lib/seo";

/**
 * Server-side sitemap builder for `/sitemap.xml` (AUB-161).
 *
 * Lives in `app/server/` (not the route file) because it imports the database
 * as a value — the Hard Rule "No `db` imports in client-side code" scopes
 * `app/routes/**` as client surface, so the route file
 * (`app/routes/sitemap[.]xml.ts`) stays a thin server-handler shell that
 * imports this module through the `~/server` seam.
 *
 * Lists every PUBLICLY reachable URL so search engines can discover listing
 * detail pages without crawling the SPA:
 *   - the static public marketing pages (`/`, `/about`);
 *   - every listing detail page (`/listings/$id`) for a listing whose
 *     `moderationStatus` is `visible` — the exact idiom the public browse/detail
 *     reads use (see `getListing` in `app/server/listings/get-listing.ts` and
 *     `browse.ts`'s `visibleListing`) so a hidden/removed listing, which 404s
 *     for a direct visitor, is never advertised to a crawler either.
 *
 * Deliberately excludes auth-gated/admin routes (`/favorites`, `/listings/new`,
 * `/admin`) — none of those are indexable by an anonymous crawler anyway, since
 * they either require a session or mutate data.
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

/** Builds the full sitemap XML document. Exported for the route + its test. */
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
