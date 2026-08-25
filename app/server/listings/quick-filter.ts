import { and, eq, type SQL, sql } from "drizzle-orm";
import { attestations, type ClaimAttribute, claims, incidents, listings } from "~/db/schema";
import { QUICK_FILTER_VALUES, type QuickFilterValue } from "~/listings/quick";
import { buildLiveSuggestionHaving } from "~/server/listings/filter";
import { RECENT_INCIDENT_WINDOW_DAYS, todayUtcMidnight } from "~/trust/incident-recency";
import { stalenessCutoff } from "~/trust/summary";

/**
 * Server-side SQL expression of the directory's prebuilt "quick" filters
 * (`?quick=`). Each token's base rule is the SQL analogue of a displayed
 * glance value (ADR-007) — the same reading a user gets from the card — so
 * filtering can never overstate safety (a celiac could be hurt by a false
 * match):
 *
 *   - `celiac` → `safetyState === "celiac-safe"` (has evidence, confirms
 *                strictly outnumber disputes, and the confirmation is fresh)
 *   - `recent` → `freshness.kind === "fresh"` (a within-window confirmation on
 *                an uncontested claim, and no recent incident — the incident
 *                cue outranks freshness, ADR-007)
 *
 * Both tokens carry the `confirmCount > disputeCount` guard, so neither can
 * return a listing whose card shows no badge and no glance cues: a contested
 * claim is suppressed to the unattested glance, and a filter must not surface
 * what the card refuses to show.
 *
 * These must stay in lockstep with the pure derivations they mirror
 * (`deriveHeadlineSafetyState` / `deriveListingTrustGlance` in `app/trust`) — the same
 * `confirmCount > disputeCount`, `hasEvidence`, staleness-cutoff and
 * recent-incident boundaries the card and the "trust" sort use.
 * `quick-filter.test.ts` pins these boundaries against a weakening regression.
 *
 * The `celiac` token also matches a live, unvoted curator-bot suggestion on
 * the headline claim by default (the shared `buildLiveSuggestionHaving` badge
 * rule from `./filter.ts` — dateless, so no freshness bound; any real vote
 * kills it). The `?bot=false` param (`includeSuggested: false`) reverts this
 * token to community-evidence-only; hiding bot-suggested-only listings from
 * the result set is `buildBrowseWhere`'s concern, not this module's. `recent`
 * deliberately ignores suggestions: a suggestion is provenance, not a
 * verification.
 *
 * Each token is a self-contained correlated subquery over `listings.id`
 * (mirroring the taxonomy filter in `./filter.ts`). A faceted selection
 * AND-composes the active tokens' subqueries, narrowing to listings that
 * match every selected facet. The result is a plain `SQL` the caller
 * AND-folds into the shared browse `where` — page and count queries alike, so
 * `total`/`hasMore` stay honest under the filter. Returns `undefined` when no
 * quick filter is active.
 *
 * Server-only: references DB tables to build SQL; imported by `./browse.ts`
 * only. The pure classification rules live in the client-safe `app/trust/*`
 * modules; this is their SQL expression.
 */

/** The single headline celiac claim attribute the glance derives from. */
const CELIAC_ATTRIBUTE: ClaimAttribute = "celiac_safe_vs_gluten_friendly";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Conditional confirm/dispute tallies over a claim's attestations. */
function tallies() {
  return {
    confirmCount: sql`count(*) filter (where ${attestations.value} = 'confirm')`,
    disputeCount: sql`count(*) filter (where ${attestations.value} = 'dispute')`,
  };
}

/** The visible-celiac-claim correlation shared by every quick predicate. */
function celiacClaimForListing(): SQL {
  return and(
    eq(claims.listingId, listings.id),
    eq(claims.attribute, CELIAC_ATTRIBUTE),
    eq(claims.moderationStatus, "visible")
  ) as SQL;
}

/**
 * `safetyState === "celiac-safe"` (tier 4): a visible celiac claim whose
 * confirms strictly outnumber disputes (`>`, never `>=` — a tie is contested,
 * not affirmed) and whose last confirmation is fresh (null, or on/after the
 * staleness cutoff — inclusive, mirroring `isStale`). Confirms-lead implies
 * at least one confirm, so `lastConfirmedAt` is non-null in practice; the
 * `is null` branch mirrors the pure `fresh` predicate exactly.
 *
 * When `includeSuggested`, a live curator-bot suggestion on the celiac claim
 * also matches (the shared {@link buildLiveSuggestionHaving} rule — suggested
 * with zero votes, exactly the badge rule). The freshness window applies only
 * to the community path: a suggestion is dateless provenance, and it dies the
 * moment any real vote lands, when the community rule takes over. The matched
 * card shows the "Suggested by Aubrey's Bot" badge, never a
 * community-confirmed signal.
 */
function celiacSafeExists(cutoff: Date, includeSuggested: boolean): SQL {
  const { confirmCount, disputeCount } = tallies();
  const communityHaving = sql`(${confirmCount} > ${disputeCount}
      and (${claims.lastConfirmedAt} is null or ${claims.lastConfirmedAt} >= ${cutoff}))`;
  const having = includeSuggested
    ? sql`${communityHaving} or ${buildLiveSuggestionHaving(confirmCount, disputeCount)}`
    : communityHaving;
  // `suggested_by` enters the GROUP BY only when the HAVING references it.
  const groupBy = includeSuggested
    ? sql`${claims.id}, ${claims.lastConfirmedAt}, ${claims.suggestedBy}`
    : sql`${claims.id}, ${claims.lastConfirmedAt}`;
  return sql`exists (
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${celiacClaimForListing()}
    group by ${groupBy}
    having ${having}
  )`;
}

/**
 * `freshness.kind === "fresh"`: a within-window confirmation on an uncontested
 * claim, and no recent incident (the incident cue outranks freshness — ADR-007
 * — so a listing with a recent incident is not "fresh" even if recently
 * confirmed).
 *
 *  - fresh confirmation: a visible celiac claim with a non-null
 *    `lastConfirmedAt` on/after the staleness cutoff (a never-confirmed claim
 *    has no timestamp to phrase, so it is not "fresh" — matching
 *    `formatFreshness` returning `null`);
 *  - uncontested: confirms strictly outnumber disputes (`>`, never `>=`).
 *    `deriveListingTrustGlance` withholds a contested claim's confirmation
 *    recency along with its badge, so a contested listing has no fresh cue to
 *    match. Without this guard the filter would surface badge-less cards under
 *    a "Recently verified" chip — a match the user cannot reproduce from the
 *    visible card. The zero-vote case needs no separate arm: `lastConfirmedAt`
 *    is recomputed from surviving confirms and cleared when none remain, so a
 *    non-null timestamp implies at least one confirm;
 *  - no recent incident: no visible incident whose `occurredOn` falls inside
 *    the inclusive {@link RECENT_INCIDENT_WINDOW_DAYS} window ending today
 *    (UTC calendar, matching `isRecentIncident`).
 */
function recentExists(cutoff: Date, now: Date): SQL {
  const { confirmCount, disputeCount } = tallies();
  const freshConfirmation = sql`exists (
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${celiacClaimForListing()}
      and ${claims.lastConfirmedAt} is not null
      and ${claims.lastConfirmedAt} >= ${cutoff}
    group by ${claims.id}
    having ${confirmCount} > ${disputeCount}
  )`;

  // The recency window as UTC calendar-date bounds, matching
  // `isRecentIncident`: `occurredOn` in [today − window, today], inclusive.
  // `now` is injected (SSR resolves it once) rather than SQL `current_date`,
  // so the boundary is deterministic and testable.
  const todayMs = todayUtcMidnight(now);
  const today = utcDay(todayMs);
  const windowStart = utcDay(todayMs - RECENT_INCIDENT_WINDOW_DAYS * MS_PER_DAY);
  // `::date` casts the bound string params so Postgres compares the `date`
  // column against a `date` (no reliance on parameter-type inference).
  const noRecentIncident = sql`not exists (
    select 1
    from ${incidents}
    where ${and(eq(incidents.listingId, listings.id), eq(incidents.moderationStatus, "visible"))}
      and ${incidents.occurredOn} >= ${windowStart}::date
      and ${incidents.occurredOn} <= ${today}::date
  )`;

  return and(freshConfirmation, noRecentIncident) as SQL;
}

/** `epoch ms → "YYYY-MM-DD"` (UTC), the calendar-date string a `date` column compares against. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The correlated `exists` predicate for a single quick token.
 *
 * `includeSuggested` affects only the `celiac` token. A suggestion is not a
 * verification, so `recent` stays community-only and ignores the flag.
 */
function quickTokenPredicate(
  token: QuickFilterValue,
  cutoff: Date,
  now: Date,
  includeSuggested: boolean
): SQL {
  switch (token) {
    case "celiac":
      return celiacSafeExists(cutoff, includeSuggested);
    case "recent":
      return recentExists(cutoff, now);
    default: {
      const exhaustive: never = token;
      return exhaustive;
    }
  }
}

/**
 * Build the `quick`-filter predicate for a faceted selection, or `undefined`
 * when the selection is empty (drizzle then applies no constraint, so the
 * caller can `and(...)`-fold it safely). The active tokens' correlated
 * subqueries AND-compose, so the result matches listings satisfying every
 * selected facet. `now`/`stalenessMonths` are threaded from the loader so the
 * freshness/staleness boundary matches the displayed glance exactly.
 *
 * Tokens apply in canonical `QUICK_FILTER_VALUES` order (not the incoming
 * array's order) so the composed SQL text is stable; a single-token selection
 * returns the bare subquery.
 */
export function buildQuickFilterPredicate(
  quick: readonly QuickFilterValue[],
  now: Date,
  stalenessMonths: number,
  includeSuggested = true
): SQL | undefined {
  if (quick.length === 0) {
    return undefined;
  }
  const cutoff = stalenessCutoff(now, stalenessMonths);
  const predicates = QUICK_FILTER_VALUES.filter((token) => quick.includes(token)).map((token) =>
    quickTokenPredicate(token, cutoff, now, includeSuggested)
  );
  return predicates.length === 1 ? predicates[0] : (and(...predicates) as SQL);
}
