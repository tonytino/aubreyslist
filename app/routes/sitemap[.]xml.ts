import { createFileRoute } from "@tanstack/react-router";
import { buildSitemapXml } from "~/server/listings/sitemap";

/**
 * Dynamic `/sitemap.xml` (AUB-161).
 *
 * A TanStack Start **Server Route** (not a page) — file-name escaping
 * (`sitemap[.]xml.ts`) maps to the literal path `/sitemap.xml` (see
 * `docs/agents/routing.md`; the bracket escapes the dot so the router treats it
 * as one path segment rather than a nested `.xml` route).
 *
 * This file is deliberately a thin shell: all db-touching logic lives in
 * `app/server/listings/sitemap.ts`, because the Hard Rules scope
 * `app/routes/**` as client surface where the database must never be imported
 * as a value (see `.github/scripts/check-hard-rules.mjs` rule #3). The route
 * only wires the GET handler.
 *
 * No caching headers are set: sitemap crawls are infrequent and the underlying
 * query is a single `WHERE moderation_status = 'visible'` scan over a
 * pilot-scale table, so a fresh read per request is cheap and always correct
 * (a listing hidden a second ago is never a stale hit). If the table ever
 * approaches the sitemap-protocol cap (50k URLs per file), split into a
 * sitemap index — tracked as a non-goal for v1.
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
