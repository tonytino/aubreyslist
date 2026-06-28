import { createServerFn } from "@tanstack/react-start";
import { type SQL, asc, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";

/**
 * Server-side text search over listings (issue #34, Discovery — domain.md).
 *
 * Searches restaurant `name` and `address` with a case-insensitive partial
 * match (Postgres `ILIKE '%term%'`). The `domain.md` Discovery section calls
 * for searching "name/cuisine", but **cuisine is not modeled in v1** — there is
 * no `cuisine` column on the `listings` table (see `db/schema.ts`). When a
 * future migration adds one, extend {@link buildSearchPredicate} to OR a third
 * `ilike(listings.cuisine, …)` term and the rest of this module stays as-is.
 *
 * The search is split into a pure predicate builder ({@link buildSearchPredicate})
 * and a thin DB-running wrapper ({@link runListingSearch}) so the matching logic
 * is unit-testable without a live database, and so the predicate can later be
 * combined (`and(searchPredicate, …filterPredicates)`) by the browse route's
 * filter/sort work (#35/#36) without reaching back into this module.
 *
 * Results are bounded (issue #97): every query runs with a `LIMIT` and offset so
 * a broad/empty search can never stream the entire table. The page size and page
 * number are validated with safe defaults and an upper bound, mirroring the
 * browse list (`./browse.ts`) so search and browse paginate identically.
 */

/** Default page size for a listing search. */
export const SEARCH_PAGE_SIZE = 50;
/**
 * Hard upper bound on the page size. A caller can ask for fewer rows but never
 * more than this — the validator clamps anything larger (mirrors browse's cap).
 */
const MAX_PAGE_SIZE = 50;

/** Validated input for a listing text search. */
export const listingSearchInputSchema = z.object({
  /** Free-text query. Empty / whitespace-only is allowed (see below). */
  query: z.string().max(256),
  /** 1-based page number. Defaults to the first page. */
  page: z.number().int().min(1).default(1),
  /** Page size; clamped to {@link MAX_PAGE_SIZE}. Defaults to {@link SEARCH_PAGE_SIZE}. */
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(SEARCH_PAGE_SIZE),
});
export type ListingSearchInput = z.infer<typeof listingSearchInputSchema>;

/**
 * Build the case-insensitive `WHERE` predicate for a text search, or `undefined`
 * when the query is empty/whitespace-only.
 *
 * Returning `undefined` is deliberate: an empty query is treated as "no text
 * constraint" rather than an error, so a caller can spread it into a query
 * (`.where(buildSearchPredicate(q))` — drizzle treats `undefined` as no filter)
 * and get **all** listings back (now bounded by the `LIMIT`, see
 * {@link runListingSearch}). This keeps the predicate composable with the
 * filter/sort work: `and(buildSearchPredicate(q), …otherFilters)` simply drops
 * the text term when the box is blank.
 *
 * The returned `SQL` ORs the term across `name` and `address`. `%`/`_` in the
 * raw input are not escaped: they act as user-facing wildcards, which is benign
 * for a read-only search and keeps the surface small.
 */
export function buildSearchPredicate(query: string): SQL | undefined {
  const term = query.trim();
  if (term.length === 0) {
    return undefined;
  }

  const pattern = `%${term}%`;
  // `cuisine` is intentionally absent — not modeled in v1 (see module JSDoc).
  return or(ilike(listings.name, pattern), ilike(listings.address, pattern));
}

/**
 * Run a listing text search against the database.
 *
 * Thin wrapper over {@link buildSearchPredicate} + a single bounded `select`. An
 * empty or whitespace-only query matches **all** listings (the predicate is
 * `undefined`, so no `WHERE` is applied) — chosen over returning `[]` so the
 * browse route can treat a blank search box as "show everything" and let filters/
 * sort narrow from there. Either way the result is bounded by `LIMIT pageSize`
 * with an `OFFSET` derived from the 1-based `page`, ordered alphabetically by
 * `name` so paging is stable (matches the browse list's order).
 */
export async function runListingSearch(input: ListingSearchInput): Promise<Listing[]> {
  const { query, page, pageSize } = input;
  const offset = (page - 1) * pageSize;
  return getDb()
    .select()
    .from(listings)
    .where(buildSearchPredicate(query))
    .orderBy(asc(listings.name))
    .limit(pageSize)
    .offset(offset);
}

/**
 * Server function entry point for the browse/search UI. Validates input, then
 * delegates to {@link runListingSearch}. Returns the full typed `Listing` rows;
 * a later issue may narrow the surface if the list view needs less.
 */
export const searchListings = createServerFn({ method: "GET" })
  .validator(listingSearchInputSchema)
  .handler(({ data }) => runListingSearch(data));
