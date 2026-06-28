import { createServerFn } from "@tanstack/react-start";
import { getSetting } from "~/server/settings";
import { type BrowseListingsPage, browseListingsInputSchema, getBrowseListings } from "./browse";

/**
 * Client-callable browse-list server function (issue #33).
 *
 * The ONLY part of the browse server layer that client code (the `/listings`
 * route + its cards) imports. Following the `*.fn.ts` convention (see
 * `app/server/incidents/incidents.fn.ts`), the db-touching implementation lives
 * in `./browse.ts` and the TanStack Start plugin strips this handler's body out
 * of the browser bundle — so importing from here never drags `getDb`
 * (neon/drizzle) into the client build.
 *
 * The handler resolves "now" ONCE on the server and reads the admin-tunable
 * `staleness_months` AppSetting (ADR-007), then threads both into the pure trust
 * derivation so the headline celiac-safe/stale glance matches the
 * listing-detail page exactly (no SSR/client drift, no hard-coded window).
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchBrowseListings = createServerFn({ method: "GET" })
  .validator(browseListingsInputSchema)
  .handler(async ({ data }): Promise<BrowseListingsPage> => {
    const stalenessMonths = await getSetting("staleness_months");
    return getBrowseListings(data, new Date(), stalenessMonths);
  });
