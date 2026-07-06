/**
 * Typed listing links — the single, client-safe source of truth (AUB-202).
 *
 * A listing can carry one link per KIND (menu, gluten-free menu, website,
 * reservations, online ordering) in the `listing_links` table, replacing the
 * single undistinguished legacy `listings.menu_url` column for new writes.
 *
 * CLIENT-SAFE: a plain `as const` string tuple + Zod schemas with NO
 * drizzle/neon/db import, mirroring `app/listings/taxonomy.ts` (#126). The
 * add-listing wizard and the detail page's edit-links dialog (client bundle)
 * reference THIS module; the db-touching implementation lives in
 * `app/server/listing-links/`.
 *
 * SINGLE SOURCE OF TRUTH: `db/schema.ts` derives its `listing_link_kind`
 * pgEnum from this same tuple (exactly like `claim_attribute` derives from
 * `CLAIM_ATTRIBUTES`), so the enum values stay in lockstep automatically. Keep
 * this file free of any `db`/server-only imports.
 *
 * Order is meaningful: it is the order links render on the detail page and the
 * persisted enum order (Postgres sorts an enum column by declaration order).
 * Do not reorder without intent.
 */

import { z } from "zod";
import { isHttpUrl } from "~/server/listings/url";

export const LINK_KINDS = [
  "menu",
  "gluten_free_menu",
  "website",
  "reservations",
  "online_ordering",
] as const;

/** String-union of the link kinds (e.g. for exhaustive label/icon maps). */
export type LinkKind = (typeof LINK_KINDS)[number];

/** Display copy per kind: the button/field label + a short field hint. */
export const LINK_KIND_METADATA: Record<LinkKind, { label: string; hint: string }> = {
  menu: {
    label: "Menu",
    hint: "Paste a link to the restaurant's menu. No uploads.",
  },
  gluten_free_menu: {
    label: "Gluten-free menu",
    hint: "A dedicated gluten-free menu page, if they publish one.",
  },
  website: {
    label: "Website",
    hint: "The restaurant's own site.",
  },
  reservations: {
    label: "Reservations",
    hint: "Where to book a table.",
  },
  online_ordering: {
    label: "Online ordering",
    hint: "Where to order pickup or delivery.",
  },
};

/**
 * An http(s)-only link URL. Identical rules to the intake `menuUrl` validator
 * it supersedes (#90): `z.string().url()` alone accepts `javascript:`/`data:`
 * URLs, which — rendered into an anchor `href` — is a stored-XSS / untrusted-
 * navigation vector, so the scheme is restricted via {@link isHttpUrl}.
 */
const linkUrl = z
  .string()
  .url("Enter a valid URL (including https://).")
  .max(2048)
  .refine(isHttpUrl, "Links must start with http:// or https://.");

/** One typed link: a kind from the fixed taxonomy + an http(s)-only URL. */
export const listingLinkInputSchema = z.object({
  kind: z.enum(LINK_KINDS),
  url: linkUrl,
});
export type ListingLinkInput = z.infer<typeof listingLinkInputSchema>;

/**
 * A set of typed links, one per kind at most (the v1 model: `listing_links`
 * has a UNIQUE(listing_id, kind) constraint, so a duplicate kind could only
 * ever surface as a DB error — reject it at validation instead).
 */
export const listingLinksInputSchema = z
  .array(listingLinkInputSchema)
  .max(LINK_KINDS.length)
  .refine(
    (links) => new Set(links.map((link) => link.kind)).size === links.length,
    "Each link kind can appear only once."
  );

/** Validated input for the public per-listing links read. */
export const listListingLinksInputSchema = z.object({ listingId: z.string().min(1) });
export type ListListingLinksInput = z.infer<typeof listListingLinksInputSchema>;

/** Validated input for the save (upsert-by-kind) write. */
export const saveListingLinkInputSchema = listingLinkInputSchema.extend({
  listingId: z.string().min(1),
});
export type SaveListingLinkInput = z.infer<typeof saveListingLinkInputSchema>;

/** Validated input for the remove write. */
export const removeListingLinkInputSchema = z.object({
  listingId: z.string().min(1),
  kind: z.enum(LINK_KINDS),
});
export type RemoveListingLinkInput = z.infer<typeof removeListingLinkInputSchema>;
