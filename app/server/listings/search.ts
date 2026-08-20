import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";

/**
 * Server-side text search over listings.
 *
 * Searches restaurant `name` and `address` with a case-insensitive partial
 * match (Postgres `ILIKE '%term%'`). Cuisine is not modeled in v1 — there is
 * no `cuisine` column on `listings`. When a migration adds one, extend
 * {@link buildSearchPredicate} with a third `ilike` term; the rest of this
 * module stays as-is.
 *
 * Split into a pure predicate builder ({@link buildSearchPredicate}) and a
 * thin DB wrapper ({@link runListingSearch}), so the matching logic is
 * unit-testable without a live database and the predicate composes with the
 * browse filters via `and(...)`.
 *
 * Results are bounded: every query runs with a `LIMIT` and offset, so a
 * broad/empty search can never stream the entire table. Page size and number
 * are validated with safe defaults and an upper bound, mirroring
 * `./browse.ts` so search and browse paginate identically.
 */

/** Default page size for a listing search. */
export const SEARCH_PAGE_SIZE = 50;
/**
 * Hard upper bound on the page size, enforced by the validator (mirrors
 * browse's cap).
 */
const MAX_PAGE_SIZE = 50;

/** Validated input for a listing text search. */
export const listingSearchInputSchema = z.object({
  /** Free-text query. Empty/whitespace-only means no text constraint. */
  query: z.string().max(256),
  /** 1-based page number. Defaults to the first page. */
  page: z.number().int().min(1).default(1),
  /** Page size; clamped to {@link MAX_PAGE_SIZE}. Defaults to {@link SEARCH_PAGE_SIZE}. */
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(SEARCH_PAGE_SIZE),
});
export type ListingSearchInput = z.infer<typeof listingSearchInputSchema>;

/**
 * Build the case-insensitive `WHERE` predicate for a text search, or
 * `undefined` when the query is empty/whitespace-only.
 *
 * `undefined` means "no text constraint", not an error: drizzle treats it as
 * no filter, so `and(buildSearchPredicate(q), …otherFilters)` simply drops
 * the text term when the box is blank and all listings come back (bounded by
 * the `LIMIT` in {@link runListingSearch}).
 *
 * The returned `SQL` ORs the term across `name` and `address`. `%`/`_` are
 * not escaped: they act as user-facing wildcards, benign for a read-only
 * search.
 */
export function buildSearchPredicate(query: string): SQL | undefined {
  const term = query.trim();
  if (term.length === 0) {
    return undefined;
  }

  const pattern = `%${term}%`;
  // `cuisine` is absent: not modeled in v1 (see module JSDoc).
  return or(ilike(listings.name, pattern), ilike(listings.address, pattern));
}

/**
 * Run a listing text search against the database.
 *
 * Thin wrapper over {@link buildSearchPredicate} plus a single bounded
 * `select`. An empty or whitespace-only query matches all visible listings —
 * chosen over returning `[]` so a blank search box means "show everything",
 * narrowed by filters. Either way the result is bounded by `LIMIT pageSize`
 * with an `OFFSET` from the 1-based `page`, ordered by `name` so paging is
 * stable (matches the browse list's order).
 *
 * Public, addressable read (every `createServerFn` is an RPC), so the
 * visibility predicate always applies: hidden/removed listings can never
 * surface via a name/address search. The text predicate AND-folds with it,
 * mirroring `browse.ts`.
 */
export async function runListingSearch(input: ListingSearchInput): Promise<Listing[]> {
  const { query, page, pageSize } = input;
  const offset = (page - 1) * pageSize;
  // Always constrain to visible listings; AND-fold the optional text predicate.
  const visibleListing = eq(listings.moderationStatus, "visible");
  const searchPredicate = buildSearchPredicate(query);
  const where = searchPredicate ? and(visibleListing, searchPredicate) : visibleListing;
  return getDb()
    .select()
    .from(listings)
    .where(where)
    .orderBy(asc(listings.name))
    .limit(pageSize)
    .offset(offset);
}

/**
 * Server-function entry point for the browse/search UI. Validates input, then
 * delegates to {@link runListingSearch}. Returns the full typed `Listing`
 * rows.
 */
export const searchListings = createServerFn({ method: "GET" })
  .validator(listingSearchInputSchema)
  .handler(({ data }) => runListingSearch(data));
