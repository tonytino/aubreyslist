import { type SQL, and, eq, gt, sql } from "drizzle-orm";
import { attestations, claims, listings } from "~/db/schema";
import type { ClaimAttribute } from "~/db/schema";

/**
 * Server-side GF taxonomy filtering for the browse list (issue #35, the killer
 * feature — domain.md → Discovery). Restricts the browse list to listings that
 * meet the user's bar across one or more fixed-taxonomy attributes (e.g.
 * "celiac-safe + dedicated fryer").
 *
 * CONSENSUS, NOT MERE EXISTENCE (the critical rule). A listing matches an
 * attribute ONLY when that attribute's claim has POSITIVE community consensus —
 * confirms strictly outnumber disputes — exactly the `confirmCount >
 * disputeCount` reading used by `deriveHeadlineSafetyState`/`hasPositiveConsensus`
 * in `app/trust/summary.ts`. We never match just because a `claims` row exists:
 * an unattested or contested (tie / dispute-majority) claim does NOT qualify, so
 * the filter can't overstate safety (a celiac could be hurt by a false match).
 *
 * Recency is deliberately NOT part of the SQL match: a stale-but-uncontested
 * consensus still represents real visible evidence and should surface (the
 * card's own glance flags staleness separately). This mirrors the documented
 * `hasPositiveConsensus` rule.
 *
 * The predicate is built as one `EXISTS` correlated subquery PER selected
 * attribute, AND-combined, so:
 *  - the rule is enforced in the database (no fetch-then-filter, so pagination
 *    and the total count stay correct under the filter), and
 *  - it composes with the text-search predicate and future sort via `and(...)`
 *    — each attribute is an independent `AND` term that narrows the same
 *    `listings` query (see `buildBrowseWhere`).
 *
 * Server-only: this module references DB tables/columns to build SQL. It is
 * imported by `./browse.ts` (server) only — never by client code. The pure
 * consensus RULE lives in the client-safe `app/trust/summary.ts`; this module is
 * the SQL expression of that same rule.
 */

/**
 * Build the per-attribute consensus `EXISTS` predicate for `attribute`:
 * "there is a claim on this listing for `attribute` whose attestations have
 * strictly more confirms than disputes".
 *
 * Correlated on `claims.listingId = listings.id` so it filters the outer
 * `listings` row. The confirm/dispute tallies come from one grouped
 * `count(*) filter (...)` over the claim's attestations (mirroring the browse
 * aggregate query), and `gt(confirms, disputes)` encodes the strict
 * positive-consensus rule. A claim with no attestations has `0 > 0` → excluded.
 */
function buildAttributeConsensusExists(attribute: ClaimAttribute): SQL {
  const confirmCount = sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`;
  const disputeCount = sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`;

  const consensusClaims = sql`(
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${and(eq(claims.listingId, listings.id), eq(claims.attribute, attribute))}
    group by ${claims.id}
    having ${gt(confirmCount, disputeCount)}
  )`;

  return sql`exists ${consensusClaims}`;
}

/**
 * Build the combined GF-taxonomy filter predicate for `attributes`, or
 * `undefined` when the list is empty (no taxonomy constraint).
 *
 * Returning `undefined` for an empty selection is deliberate and mirrors
 * `buildSearchPredicate`: drizzle treats `undefined` as "no filter", so the
 * caller can `and(searchPredicate, buildTaxonomyFilterPredicate(attrs))` and get
 * the unfiltered list when nothing is selected. Multiple attributes are
 * AND-combined: a listing must have positive consensus for EVERY selected
 * attribute (the "celiac-safe AND dedicated fryer" semantics).
 *
 * Duplicate attributes are de-duplicated so a repeated `?attrs=` value can't
 * inflate the predicate.
 */
export function buildTaxonomyFilterPredicate(
  attributes: readonly ClaimAttribute[]
): SQL | undefined {
  const unique = [...new Set(attributes)];
  if (unique.length === 0) {
    return undefined;
  }
  return and(...unique.map(buildAttributeConsensusExists));
}

/**
 * Compose the full browse `WHERE` from the optional text-search predicate and
 * the optional GF-taxonomy filter predicate, AND-combined. Returns `undefined`
 * when neither constrains anything (drizzle then applies no `WHERE`).
 *
 * This is the single composition seam the browse loader uses for BOTH its
 * paged-listings query and its total-count query, so the count always reflects
 * the same filters as the page (pagination stays correct). It is intentionally
 * sort-agnostic so the parallel sort work (#36) can layer `orderBy` on top
 * without touching the filter.
 */
export function buildBrowseWhere(
  searchPredicate: SQL | undefined,
  attributes: readonly ClaimAttribute[]
): SQL | undefined {
  return and(searchPredicate, buildTaxonomyFilterPredicate(attributes));
}
