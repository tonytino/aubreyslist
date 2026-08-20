import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";
import { absoluteUrl } from "~/lib/seo";

/**
 * Server-side sitemap builder for `/sitemap.xml`.
 *
 * Lives in `app/server/` (not the route file) because it imports the database
 * as a value — the "no `db` imports in client-side code" Hard Rule scopes
 * `app/routes/**` as client surface, so the route file stays a thin
 * server-handler shell over this module.
 *
 * Lists every publicly reachable URL so search engines can discover listing
 * detail pages without crawling the SPA: the static marketing pages plus
 * every `/listings/$id` whose `moderationStatus` is `visible` — the same
 * idiom as the public browse/detail reads, so a listing that 404s for a
 * direct visitor is never advertised to a crawler.
 *
 * Deliberately excludes auth-gated/admin routes (`/favorites`,
 * `/listings/new`, `/admin`): they require a session or mutate data.
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

/** Ids of every publicly visible listing, in the browse/detail idiom. */
async function getVisibleListingIds(): Promise<string[]> {
  const rows = await getDb().query.listings.findMany({
    columns: { id: true },
    where: eq(listings.moderationStatus, "visible"),
  });
  return rows.map((row) => row.id);
}

/** Builds the full sitemap XML document. */
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
