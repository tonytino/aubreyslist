import { and, eq, gt, isNotNull, type SQL, sql } from "drizzle-orm";
import type { ClaimAttribute } from "~/db/schema";
import { attestations, claims, listings } from "~/db/schema";

/**
 * Server-side GF taxonomy filtering for the browse list: restrict to listings
 * that meet the user's bar across one or more fixed-taxonomy attributes
 * (e.g. "celiac-safe + dedicated fryer").
 *
 * Consensus, not mere existence: a listing matches an attribute only when
 * that attribute's claim has positive community consensus — confirms strictly
 * outnumber disputes, the exact `confirmCount > disputeCount` reading of
 * `hasPositiveConsensus` in `app/trust/summary.ts`. A contested (tie or
 * dispute-majority) claim never qualifies, so the filter can't overstate
 * safety (a celiac could be hurt by a false match).
 *
 * Live bot suggestions also match by default: a live, unvoted curator-bot
 * suggestion (`suggestedBy` non-null, zero attestations — the badge rule, see
 * {@link buildLiveSuggestionHaving}) matches as an OR-branch, a discovery
 * aid. The `?bot=false` browse param (`includeSuggested: false`) reverts to
 * community-evidence-only matching and additionally hides bot-suggested-only
 * listings from the result set ({@link buildSuggestedOnlyExclusion}). Any
 * real vote — including a dispute — kills the suggestion branch instantly. A
 * bare, non-suggested claim with no votes never matches in either mode.
 *
 * Recency is deliberately not part of the SQL match: a stale-but-uncontested
 * consensus is still real visible evidence and should surface (the card's
 * glance flags staleness separately), mirroring `hasPositiveConsensus`.
 *
 * One `EXISTS` correlated subquery per selected attribute, AND-combined, so
 * the rule is enforced in the database (no fetch-then-filter — pagination and
 * the total stay correct) and composes with the search predicate via
 * `and(...)` (see `buildBrowseWhere`).
 *
 * Server-only: references DB tables to build SQL; imported by `./browse.ts`
 * only, never by client code. The pure consensus rule lives in the
 * client-safe `app/trust/summary.ts`; this module is its SQL expression.
 */

/**
 * SQL of the live-suggestion rule: the claim was suggested by the curator bot
 * (`suggestedBy` non-null) and no real user has attested it (zero
 * confirm/dispute rows). The exact rule the "Suggested by Aubrey's Bot" badge
 * derives from (`summarizeClaim`: `suggested && !hasEvidence`), kept as one
 * shared fragment (also used by `./quick-filter.ts`) so the filter can never
 * use a different notion of "suggested" than the badge. The first real vote
 * clears `suggestedBy` server-side; the zero-evidence guard here mirrors the
 * belt-and-braces guard in `summarizeClaim`, so any vote — a dispute included
 * — kills the suggestion match even if that clear lags.
 *
 * A suggestion is provenance, not evidence (ADR-007): it never inflates the
 * confirm/dispute tallies. Matching on it is a discovery aid. The browse card
 * labels a live suggestion on any visible claim and badges each suggested
 * attribute, so a suggestion-matched card always shows where its labels came
 * from; the badges read as bot provenance, never per-attribute consensus.
 *
 * `confirmCount`/`disputeCount` are the caller's grouped conditional tallies,
 * so this fragment slots into the same `HAVING` as the consensus rule.
 */
export function buildLiveSuggestionHaving(confirmCount: SQL, disputeCount: SQL): SQL {
  return sql`(${claims.suggestedBy} is not null and ${confirmCount} + ${disputeCount} = 0)`;
}

/**
 * Per-attribute `EXISTS` predicate: a claim on this listing for `attribute`
 * whose attestations have strictly more confirms than disputes — or, when
 * `includeSuggested` (the default), whose claim is a live curator-bot
 * suggestion ({@link buildLiveSuggestionHaving}).
 *
 * Correlated on `claims.listingId = listings.id`, so it filters the outer
 * `listings` row. The tallies come from one grouped `count(*) filter (...)`
 * over the claim's attestations, and `gt(confirms, disputes)` encodes strict
 * positive consensus. A claim with no attestations is `0 > 0` — excluded from
 * the community path; it can only match via a live suggestion when
 * suggestions are included.
 *
 * Only `visible` claims count on both paths: a hidden/removed claim must
 * never make a listing match, consistent with the browse card aggregate and
 * the listing-detail roll-up.
 */
function buildAttributeConsensusExists(attribute: ClaimAttribute, includeSuggested: boolean): SQL {
  const confirmCount = sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`;
  const disputeCount = sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`;

  // Community consensus: confirms strictly outnumber disputes. A live
  // suggestion is an OR-branch, mutually exclusive with it by construction
  // (consensus needs a confirm; a live suggestion needs zero votes).
  const having = includeSuggested
    ? sql`${gt(confirmCount, disputeCount)} or ${buildLiveSuggestionHaving(confirmCount, disputeCount)}`
    : sql`${gt(confirmCount, disputeCount)}`;
  // `suggested_by` enters the GROUP BY only when the HAVING references it.
  const groupBy = includeSuggested ? sql`${claims.id}, ${claims.suggestedBy}` : sql`${claims.id}`;

  const consensusClaims = sql`(
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${and(eq(claims.listingId, listings.id), eq(claims.attribute, attribute), eq(claims.moderationStatus, "visible"))}
    group by ${groupBy}
    having ${having}
  )`;

  return sql`exists ${consensusClaims}`;
}

/**
 * Combined GF-taxonomy filter predicate for `attributes`, or `undefined` when
 * the list is empty (no taxonomy constraint — drizzle treats `undefined` as
 * no filter, mirroring `buildSearchPredicate`). Multiple attributes are
 * AND-combined: a listing needs positive consensus for every selected
 * attribute ("celiac-safe AND dedicated fryer" semantics).
 *
 * Duplicate attributes are de-duplicated so a repeated `?attrs=` value can't
 * inflate the predicate.
 *
 * `includeSuggested` (default true) also matches attributes whose claim is a
 * live curator-bot suggestion; the `?bot=` param turns that off. The flag's
 * other effect — hiding bot-suggested-only listings — lives in
 * `buildBrowseWhere` via {@link buildSuggestedOnlyExclusion}, not here: this
 * predicate only ever narrows matching for the selected attrs.
 */
export function buildTaxonomyFilterPredicate(
  attributes: readonly ClaimAttribute[],
  includeSuggested = true
): SQL | undefined {
  const unique = [...new Set(attributes)];
  if (unique.length === 0) {
    return undefined;
  }
  return and(
    ...unique.map((attribute) => buildAttributeConsensusExists(attribute, includeSuggested))
  );
}

/**
 * The "Hide bot suggestions" result-set exclusion (`?bot=false`,
 * `includeSuggested: false`): drop every bot-suggested-only listing — one
 * carrying a live curator-bot suggestion on some visible claim with no
 * community attestation evidence on any visible claim. Those are exactly the
 * listings whose browse card is driven by suggestion alone, the ones the chip
 * exists to hide. A listing with any real community evidence stays visible
 * regardless: real evidence is never hidden (ADR-007 — this changes only
 * which listings are returned, never how trust is derived or displayed).
 *
 * "Live/unvoted" is implied by the composition: the no-evidence conjunct
 * means every suggested claim here has zero attestations — the same
 * live-suggestion reading as {@link buildLiveSuggestionHaving} without
 * per-claim tallies. The first real vote on any claim moves the listing out
 * of the excluded set (and `castVote` clears `suggested_by` besides).
 *
 * Both existence checks are bounded to `visible` claims: a hidden/removed
 * suggested claim cannot cause an exclusion, and a hidden/removed claim's
 * attestations cannot rescue one.
 *
 * Rendered as `NOT (has-live-suggestion AND NOT has-any-evidence)` — plain
 * correlated `EXISTS` subqueries over the outer `listings` row, so the caller
 * can AND-fold it into the shared browse `where` (page and count queries
 * alike; a post-query JS filter would break pagination and the honest total).
 */
export function buildSuggestedOnlyExclusion(): SQL {
  const liveSuggestionExists = sql`exists (
    select 1
    from ${claims}
    where ${and(eq(claims.listingId, listings.id), isNotNull(claims.suggestedBy), eq(claims.moderationStatus, "visible"))}
  )`;
  const anyEvidenceExists = sql`exists (
    select 1
    from ${claims}
    inner join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${and(eq(claims.listingId, listings.id), eq(claims.moderationStatus, "visible"))}
  )`;
  return sql`not (${liveSuggestionExists} and not ${anyEvidenceExists})`;
}

/**
 * Compose the full browse `WHERE` from the optional text-search predicate and
 * the optional GF-taxonomy predicate, AND-combined. Returns `undefined` when
 * neither constrains anything (drizzle then applies no `WHERE`).
 *
 * `includeSuggested: false` (the "Hide bot suggestions" chip) contributes a
 * third term, the {@link buildSuggestedOnlyExclusion} result-set exclusion,
 * so bot-suggested-only listings disappear from the page even when no other
 * filter is active.
 *
 * The single composition seam the browse loader uses for both its
 * paged-listings query and its total-count query, so the count always
 * reflects the same filters as the page. Intentionally sort-agnostic: sorting
 * layers `orderBy` on top without touching the filter.
 */
export function buildBrowseWhere(
  searchPredicate: SQL | undefined,
  attributes: readonly ClaimAttribute[],
  includeSuggested = true
): SQL | undefined {
  return and(
    searchPredicate,
    buildTaxonomyFilterPredicate(attributes, includeSuggested),
    includeSuggested ? undefined : buildSuggestedOnlyExclusion()
  );
}
