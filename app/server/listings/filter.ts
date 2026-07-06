import { and, eq, gt, isNotNull, type SQL, sql } from "drizzle-orm";
import type { ClaimAttribute } from "~/db/schema";
import { attestations, claims, listings } from "~/db/schema";

/**
 * Server-side GF taxonomy filtering for the browse list (issue #35, the killer
 * feature — domain.md → Discovery). Restricts the browse list to listings that
 * meet the user's bar across one or more fixed-taxonomy attributes (e.g.
 * "celiac-safe + dedicated fryer").
 *
 * CONSENSUS, NOT MERE EXISTENCE (the base rule). A listing matches an
 * attribute when that attribute's claim has POSITIVE community consensus —
 * confirms strictly outnumber disputes — exactly the `confirmCount >
 * disputeCount` reading used by `deriveHeadlineSafetyState`/`hasPositiveConsensus`
 * in `app/trust/summary.ts`. A contested (tie / dispute-majority) claim never
 * qualifies, so the filter can't overstate safety (a celiac could be hurt by a
 * false match).
 *
 * PLUS LIVE BOT SUGGESTIONS BY DEFAULT (AUB-31). A claim that is a live,
 * unvoted curator-bot suggestion (`suggestedBy` non-null, ZERO attestations —
 * the exact badge rule, see {@link buildLiveSuggestionHaving}) ALSO matches as
 * an OR-branch. This is a discovery aid, on by default; the `?bot=false` browse
 * param (`includeSuggested: false`) reverts to community-evidence-only
 * matching AND additionally HIDES bot-suggested-only listings from the result
 * set entirely (see {@link buildSuggestedOnlyExclusion}) — the "Hide bot
 * suggestions" chip removes the listings whose browse card is driven by
 * suggestion alone, not just their filter participation. Any real vote —
 * including a dispute — kills the suggestion branch instantly. A bare,
 * non-suggested `claims` row with no votes still never matches under either
 * mode.
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
 * SQL of the LIVE-SUGGESTION rule (AUB-31): the claim was suggested by the
 * curator bot (`suggestedBy` non-null) AND no real user has attested it yet
 * (zero confirm/dispute rows). This is the EXACT rule the "Suggested by
 * Aubrey's Bot" badge derives from — `summarizeClaim` in `app/trust/summary.ts`
 * computes `suggested: aggregate.suggested && !hasEvidence(aggregate)` — kept as
 * ONE shared fragment (also used by `./quick-filter.ts`) so the filter can never
 * use a different notion of "suggested" than the badge does. The first real vote
 * clears `suggestedBy` server-side (`recomputeLastConfirmedAt`), and the
 * zero-evidence guard here mirrors the belt-and-braces guard in `summarizeClaim`
 * — so a dispute (or any vote) kills the suggestion match immediately, even if
 * the clear ever lagged.
 *
 * A suggestion is provenance, not evidence (ADR-007): it never inflates the
 * confirm/dispute tallies. Including it in filter MATCHING is a discovery aid
 * ("show me candidates worth validating"). HONEST SCOPE OF THE CARD CUE
 * (owner nit 7): the browse card labels a live suggestion on ANY visible claim
 * "Suggested by Aubrey's Bot" and badges each suggested attribute
 * (`deriveListingTrustGlance`), regardless of whether real celiac evidence
 * exists — so a suggestion-matched card ALWAYS shows where its labels came
 * from. Nothing overstates community confirmation either way: the suggested
 * badges are styled as bot provenance, never as per-attribute consensus.
 *
 * `confirmCount`/`disputeCount` are the caller's grouped conditional tallies, so
 * this fragment slots into the same `HAVING` as the consensus rule.
 */
export function buildLiveSuggestionHaving(confirmCount: SQL, disputeCount: SQL): SQL {
  return sql`(${claims.suggestedBy} is not null and ${confirmCount} + ${disputeCount} = 0)`;
}

/**
 * Build the per-attribute `EXISTS` predicate for `attribute`:
 * "there is a claim on this listing for `attribute` whose attestations have
 * strictly more confirms than disputes" — OR, when `includeSuggested` (the
 * default), "…or whose claim is a LIVE curator-bot suggestion" (see
 * {@link buildLiveSuggestionHaving}).
 *
 * Correlated on `claims.listingId = listings.id` so it filters the outer
 * `listings` row. The confirm/dispute tallies come from one grouped
 * `count(*) filter (...)` over the claim's attestations (mirroring the browse
 * aggregate query), and `gt(confirms, disputes)` encodes the strict
 * positive-consensus rule. A claim with no attestations has `0 > 0` → excluded
 * from the community path (it can only match via a live suggestion, and only
 * when suggestions are included).
 *
 * Visibility (#41): only `visible` claims count toward consensus — a
 * hidden/removed claim must never make a listing match the taxonomy filter
 * (consistent with the browse card aggregate + the listing-detail roll-up, which
 * also exclude non-visible claims). The same visibility bound applies to the
 * suggestion path.
 */
function buildAttributeConsensusExists(attribute: ClaimAttribute, includeSuggested: boolean): SQL {
  const confirmCount = sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`;
  const disputeCount = sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`;

  // Community consensus (the original rule) — confirms STRICTLY outnumber
  // disputes. When suggestions participate, a live suggestion is an OR-branch:
  // the two paths are mutually exclusive by construction (consensus needs ≥ 1
  // confirm; a live suggestion needs ZERO votes).
  const having = includeSuggested
    ? sql`${gt(confirmCount, disputeCount)} or ${buildLiveSuggestionHaving(confirmCount, disputeCount)}`
    : sql`${gt(confirmCount, disputeCount)}`;
  // `suggested_by` only enters the GROUP BY when the HAVING references it, so
  // the flag-off predicate renders byte-identical to the pre-AUB-31 form.
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
 *
 * `includeSuggested` (default true) also matches attributes whose claim is a
 * LIVE curator-bot suggestion (AUB-31) — the `?bot=` browse param turns this
 * off, reverting this predicate to community-evidence-only matching. (The
 * flag's OTHER effect — hiding bot-suggested-only listings from the result set
 * — lives in `buildBrowseWhere` via {@link buildSuggestedOnlyExclusion}, not
 * here: this predicate only ever NARROWS matching for the selected attrs.)
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
 * The "Hide bot suggestions" RESULT-SET exclusion (`?bot=false`,
 * `includeSuggested: false`): drop every listing that is BOT-SUGGESTED-ONLY —
 * i.e. it carries a live curator-bot suggestion on some visible claim
 * (`getBotSuggestedListingIds`'s existence rule in `./browse.ts`, AUB-193)
 * AND has NO real community attestation evidence on ANY visible claim. Those are exactly the listings whose browse card is driven by
 * suggestion alone (the "Suggested by Aubrey's Bot" cards) — the ones the chip
 * exists to hide. A listing with ANY real community evidence stays visible
 * regardless of also carrying live suggestions: real evidence is never hidden
 * (ADR-007 — this changes only which listings are RETURNED, never how trust is
 * derived or displayed).
 *
 * "Live/unvoted" is implied by the composition: the no-evidence-anywhere
 * conjunct means every suggested claim here has ZERO attestations, so this is
 * the same live-suggestion reading as {@link buildLiveSuggestionHaving}
 * without needing per-claim tallies. The first real vote on ANY claim moves
 * the listing out of the excluded set immediately (and `castVote` clears
 * `suggested_by` on the voted claim besides).
 *
 * Visibility (#41): both existence checks are bounded to `visible` claims —
 * a hidden/removed suggested claim cannot cause an exclusion, and a
 * hidden/removed claim's attestations cannot rescue one.
 *
 * Rendered as `NOT (has-live-suggestion AND NOT has-any-evidence)` — plain
 * correlated `EXISTS` subqueries over the outer `listings` row, so the caller
 * can AND-fold it into the SHARED browse `where` (page query AND count query
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
 * the optional GF-taxonomy filter predicate, AND-combined. Returns `undefined`
 * when neither constrains anything (drizzle then applies no `WHERE`).
 *
 * `includeSuggested: false` (the `?bot=false` "Hide bot suggestions" chip)
 * contributes a THIRD term: the {@link buildSuggestedOnlyExclusion} result-set
 * exclusion, so bot-suggested-only listings disappear from the page even when
 * no other filter is active (previously the flag only changed filter MATCHING,
 * which made the chip a visible no-op on an unfiltered browse).
 *
 * This is the single composition seam the browse loader uses for BOTH its
 * paged-listings query and its total-count query, so the count always reflects
 * the same filters as the page (pagination stays correct). It is intentionally
 * sort-agnostic so the parallel sort work (#36) can layer `orderBy` on top
 * without touching the filter.
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
