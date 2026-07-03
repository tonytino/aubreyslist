import { type SQL, and, eq, sql } from "drizzle-orm";
import { type ClaimAttribute, attestations, claims, incidents, listings } from "~/db/schema";
import type { QuickFilter } from "~/listings/quick";
import { RECENT_INCIDENT_WINDOW_DAYS, todayUtcMidnight } from "~/trust/incident-recency";
import { stalenessCutoff } from "~/trust/summary";

/**
 * Server-side SQL expression of the directory's prebuilt "quick" filters
 * (`?quick=`, AUB-135). Each token is the SQL analogue of a DISPLAYED glance value
 * (ADR-007) — the same reading a user gets from the card — so filtering can never
 * overstate safety (a celiac could be hurt by a false match):
 *
 *   - `celiac`   → `safetyState === "celiac-safe"`   (has evidence, confirms strictly
 *                  outnumber disputes, and the confirmation is fresh)
 *   - `friendly` → `safetyState === "gluten-friendly"` (has evidence, disputes tie or
 *                  outnumber confirms — the contested / safer-lower reading)
 *   - `recent`   → `freshness.kind === "fresh"`      (a within-staleness-window
 *                  confirmation AND no recent "got glutened" incident — the incident
 *                  cue outranks freshness, ADR-007)
 *
 * These MUST stay in lockstep with the pure derivations they mirror
 * (`deriveHeadlineSafetyState` / `formatFreshness` in `app/trust`) — the same
 * `confirmCount > disputeCount`, `hasEvidence`, staleness-cutoff, and
 * recent-incident boundaries the card and the "trust" sort use. `quick-filter.test.ts`
 * pins these boundaries against a weakening regression.
 *
 * Built as ONE correlated subquery over `listings.id` (mirroring the taxonomy
 * filter in `./filter.ts`), returned as a plain `SQL` so the caller AND-folds it
 * into the SHARED browse `where` — applying it to the page query AND the count
 * query alike, so `total`/`hasMore` stay honest under the filter (no fetch-then-
 * filter). Returns `undefined` when no quick filter is active (no constraint).
 *
 * Server-only: references DB tables to build SQL; imported by `./browse.ts` only.
 * The pure classification RULES live in the client-safe `app/trust/*` modules;
 * this is the SQL expression of those same rules.
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
 * `safetyState === "celiac-safe"` (tier 4): the listing has a visible celiac claim
 * whose confirms STRICTLY outnumber disputes (`> `, never `>=` — a tie is contested,
 * not affirmed) AND whose last confirmation is fresh (null, or on/after the staleness
 * cutoff — inclusive, mirroring `isStale`). Confirms-lead implies at least one
 * confirm, so `lastConfirmedAt` is non-null here in practice; the `is null` branch
 * mirrors the pure `fresh` predicate exactly.
 */
function celiacSafeExists(cutoff: Date): SQL {
  const { confirmCount, disputeCount } = tallies();
  return sql`exists (
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${celiacClaimForListing()}
    group by ${claims.id}, ${claims.lastConfirmedAt}
    having ${confirmCount} > ${disputeCount}
      and (${claims.lastConfirmedAt} is null or ${claims.lastConfirmedAt} >= ${cutoff})
  )`;
}

/**
 * `safetyState === "gluten-friendly"` (tier 2): the listing has a visible celiac
 * claim WITH evidence (at least one attestation) whose disputes tie or outnumber
 * confirms (`confirms <= disputes`). Contested-first, mirroring
 * `deriveHeadlineSafetyState` — a live dispute majority is the safer, lower reading
 * and must never be masked.
 */
function glutenFriendlyExists(): SQL {
  const { confirmCount, disputeCount } = tallies();
  return sql`exists (
    select 1
    from ${claims}
    left join ${attestations} on ${eq(attestations.claimId, claims.id)}
    where ${celiacClaimForListing()}
    group by ${claims.id}
    having ${confirmCount} + ${disputeCount} > 0
      and ${confirmCount} <= ${disputeCount}
  )`;
}

/**
 * `freshness.kind === "fresh"`: a within-window confirmation AND no recent incident
 * (the incident cue outranks freshness — ADR-007 — so a listing with a recent
 * incident is NOT "fresh" even if recently confirmed).
 *
 *  - fresh confirmation: a visible celiac claim with a non-null `lastConfirmedAt`
 *    on/after the staleness cutoff (a never-confirmed claim has no timestamp to
 *    phrase → not "fresh", matching `formatFreshness` returning `null`);
 *  - no recent incident: no visible incident whose `occurredOn` falls inside the
 *    inclusive {@link RECENT_INCIDENT_WINDOW_DAYS} window ending today (UTC calendar,
 *    matching `isRecentIncident`).
 */
function recentExists(cutoff: Date, now: Date): SQL {
  const freshConfirmation = sql`exists (
    select 1
    from ${claims}
    where ${celiacClaimForListing()}
      and ${claims.lastConfirmedAt} is not null
      and ${claims.lastConfirmedAt} >= ${cutoff}
  )`;

  // The recency window as UTC calendar-date bounds, matching `isRecentIncident`:
  // `occurredOn` in [today − WINDOW, today], inclusive. `now` is injected (SSR
  // resolves it once) rather than using SQL `current_date`, so the boundary is
  // deterministic and testable.
  const todayMs = todayUtcMidnight(now);
  const today = utcDay(todayMs);
  const windowStart = utcDay(todayMs - RECENT_INCIDENT_WINDOW_DAYS * MS_PER_DAY);
  // `::date` casts the bound string params explicitly so Postgres compares the
  // `date` column against a `date` (no reliance on parameter-type inference).
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
 * Build the correlated `quick`-filter predicate, or `undefined` when no quick
 * filter is active (drizzle then applies no constraint, so the caller can
 * `and(...)`-fold it safely). `now`/`stalenessMonths` are threaded from the loader
 * so the freshness/staleness boundary matches the displayed glance exactly.
 */
export function buildQuickFilterPredicate(
  quick: QuickFilter | undefined,
  now: Date,
  stalenessMonths: number
): SQL | undefined {
  if (!quick) {
    return undefined;
  }
  const cutoff = stalenessCutoff(now, stalenessMonths);
  switch (quick) {
    case "celiac":
      return celiacSafeExists(cutoff);
    case "friendly":
      return glutenFriendlyExists();
    case "recent":
      return recentExists(cutoff, now);
  }
}
