import { createServerFn } from "@tanstack/react-start";
import {
  listListingLinksInputSchema,
  removeListingLinkInputSchema,
  saveListingLinkInputSchema,
} from "~/listings/links";
import { listListingLinks, removeListingLink, saveListingLink } from "./index";

/**
 * Client-callable listing-link server functions (AUB-202).
 *
 * These `createServerFn` entry points are the ONLY part of the listing-links
 * server layer that client code (the listing-detail route + the edit-links
 * dialog) imports. Following the established `*.fn.ts` convention (see
 * `app/server/incidents/incidents.fn.ts`, `get-listing.fn.ts`), the db-touching
 * implementations live in `./index.ts` and the TanStack Start plugin strips
 * their handler bodies out of the browser bundle — so importing from here never
 * drags `getDb` (neon/drizzle) into the client build. The `.validator()`s are
 * backed by the client-safe schemas in `~/listings/links`.
 *
 * Server-only at runtime; safe to import from client modules.
 */

/** Read a listing's typed links, in LINK_KINDS order. See {@link listListingLinks}. */
export const fetchListingLinks = createServerFn({ method: "GET" })
  .validator(listListingLinksInputSchema)
  .handler(({ data }) => listListingLinks(data));

/**
 * Save (upsert-by-kind) a listing link. Login-gated, rate-limited, wiki-style —
 * any signed-in user. See {@link saveListingLink}.
 */
export const submitListingLink = createServerFn({ method: "POST" })
  .validator(saveListingLinkInputSchema)
  .handler(({ data }) => saveListingLink(data));

/**
 * Remove a listing link by kind. Login-gated, rate-limited, wiki-style — any
 * signed-in user; removing an absent link is a no-op success. See
 * {@link removeListingLink}.
 */
export const deleteListingLink = createServerFn({ method: "POST" })
  .validator(removeListingLinkInputSchema)
  .handler(({ data }) => removeListingLink(data));
