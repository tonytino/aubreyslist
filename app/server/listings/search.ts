import { createServerFn } from "@tanstack/react-start";
import { type SQL, ilike, or } from "drizzle-orm";
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
 */

/** Validated input for a listing text search. */
export const listingSearchInputSchema = z.object({
  /** Free-text query. Empty / whitespace-only is allowed (see below). */
  query: z.string().max(256),
});
export type ListingSearchInput = z.infer<typeof listingSearchInputSchema>;

/**
 * Build the case-insensitive `WHERE` predicate for a text search, or `undefined`
 * when the query is empty/whitespace-only.
 *
 * Returning `undefined` is deliberate: an empty query is treated as "no text
 * constraint" rather than an error, so a caller can spread it into a query
 * (`.where(buildSearchPredicate(q))` — drizzle treats `undefined` as no filter)
 * and get **all** listings back. This keeps the predicate composable with the
 * future filter/sort work: `and(buildSearchPredicate(q), …otherFilters)` simply
 * drops the text term when the box is blank.
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
 * Thin wrapper over {@link buildSearchPredicate} + a single `select`. An empty
 * or whitespace-only query returns **all** listings (the predicate is
 * `undefined`, so no `WHERE` is applied) — chosen over returning `[]` so the
 * future browse route can treat a blank search box as "show everything" and let
 * filters/sort narrow from there.
 */
export async function runListingSearch(input: ListingSearchInput): Promise<Listing[]> {
  return getDb().select().from(listings).where(buildSearchPredicate(input.query));
}

/**
 * Server function entry point for the browse/search UI. Validates input, then
 * delegates to {@link runListingSearch}. Returns the full typed `Listing` rows;
 * a later issue may narrow the surface if the list view needs less.
 */
export const searchListings = createServerFn({ method: "GET" })
  .validator(listingSearchInputSchema)
  .handler(({ data }) => runListingSearch(data));
