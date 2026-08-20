import { createFileRoute } from "@tanstack/react-router";
import { buildSitemapXml } from "~/server/listings/sitemap";

/**
 * Dynamic `/sitemap.xml` — a TanStack Start server route, not a page.
 * File-name escaping (`sitemap[.]xml.ts`) maps to the literal path
 * `/sitemap.xml`: the bracket escapes the dot so the router treats it as one
 * path segment rather than a nested `.xml` route (docs/agents/routing.md).
 *
 * Deliberately a thin shell: all db-touching logic lives in
 * `app/server/listings/sitemap.ts`, because the Hard Rules scope
 * `app/routes/**` as client surface where the database must never be
 * imported as a value. The route only wires the GET handler.
 *
 * No caching headers: sitemap crawls are infrequent and the query is a
 * single indexed scan over a pilot-scale table, so a fresh read per request
 * is cheap and always correct (a listing hidden a second ago is never a
 * stale hit). If the table nears the sitemap-protocol cap (50k URLs per
 * file), split into a sitemap index.
 */
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
