import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildBrowseWhere,
  buildSuggestedOnlyExclusion,
  buildTaxonomyFilterPredicate,
} from "./filter";
import { buildSearchPredicate } from "./search";

/**
 * Unit tests for the GF taxonomy filter predicate builder (#35).
 *
 * The matching RULE (positive consensus: confirms strictly outnumber disputes)
 * is unit-tested directly in `app/trust/summary.test.ts`
 * (`hasPositiveConsensus`). Here we assert the SQL EXPRESSION of that rule: that
 * each selected attribute becomes a correlated `EXISTS` consensus subquery, that
 * multiple attributes AND together, and that the builder composes with the text
 * search predicate — all without a live database (docs/agents/testing.md).
 */

const dialect = new PgDialect();
function renderSql(node: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(node);
  return { sql: query.sql, params: query.params };
}

describe("buildTaxonomyFilterPredicate", () => {
  it("returns undefined for an empty selection (no constraint)", () => {
    expect(buildTaxonomyFilterPredicate([])).toBeUndefined();
  });

  it("builds an EXISTS consensus subquery for a single attribute", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"]);
    expect(predicate).toBeDefined();

    const { sql, params } = renderSql(predicate as SQL);
    const lower = sql.toLowerCase();
    // Correlated EXISTS over claims, joined to attestations, grouped per claim.
    expect(lower).toContain("exists");
    expect(lower).toContain('from "claims"');
    expect(lower).toContain('left join "attestations"');
    expect(lower).toContain("group by");
    // The positive-consensus rule: confirms strictly greater than disputes.
    expect(lower).toContain("having");
    expect(lower).toContain("'confirm'");
    expect(lower).toContain("'dispute'");
    // Scoped to the requested attribute (bound as a parameter).
    expect(params).toContain("dedicated_fryer");
    // Visibility (#41): only `visible` claims count toward consensus, so a
    // hidden/removed claim can never make a listing match the filter.
    expect(lower).toContain("moderation_status");
    expect(params).toContain("visible");
  });

  it("AND-combines one EXISTS per attribute for a multi-attribute selection", () => {
    const predicate = buildTaxonomyFilterPredicate([
      "dedicated_fryer",
      "celiac_safe_vs_gluten_friendly",
    ]);
    const { sql, params } = renderSql(predicate as SQL);
    const lower = sql.toLowerCase();

    // Two EXISTS subqueries, AND-joined.
    expect(lower.match(/exists/g)?.length).toBe(2);
    expect(lower).toContain(" and ");
    // One bound attribute parameter per selected attribute.
    expect(params).toContain("dedicated_fryer");
    expect(params).toContain("celiac_safe_vs_gluten_friendly");
  });

  it("de-duplicates a repeated attribute into a single EXISTS", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer", "dedicated_fryer"]);
    const { sql } = renderSql(predicate as SQL);
    expect(sql.toLowerCase().match(/exists/g)?.length).toBe(1);
  });

  // --- Consensus DIRECTION lock (strict `>`, not `>=`) -----------------------
  // The single trust-critical rule the SQL encodes: a claim qualifies ONLY when
  // confirms STRICTLY outnumber disputes (`hasPositiveConsensus`). A `>=` drift
  // would let a tie (or even a dispute-majority at equality) read as affirmed —
  // overstating safety, which can hurt a celiac. These assert the rendered SQL
  // keeps the strict `>` so a `>=` regression fails here, mirroring the pure-JS
  // `hasPositiveConsensus` cases in `app/trust/summary.test.ts`.

  it("encodes the STRICT confirms-greater-than-disputes consensus (HAVING confirms > disputes)", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"]);
    const lower = renderSql(predicate as SQL).sql.toLowerCase();

    // The HAVING compares the two conditional tallies with a STRICT `>`.
    expect(lower).toContain("having");
    // Strict greater-than, NOT `>=` — a tie must NOT qualify (contested ≠ affirmed).
    expect(lower).toContain(">");
    expect(lower).not.toContain(">=");
    // Both sides of the comparison are present: confirms vs disputes.
    expect(lower).toContain("'confirm'");
    expect(lower).toContain("'dispute'");
    // The comparison is the `filter (where … = 'confirm')` tally on the LEFT of
    // `>` and the `'dispute'` tally on the RIGHT — i.e. confirms > disputes, not
    // the inverse. We assert ordering by where each literal falls around the `>`.
    const gtIndex = lower.indexOf(" > ");
    expect(gtIndex).toBeGreaterThan(-1);
    expect(lower.indexOf("'confirm'")).toBeLessThan(gtIndex);
    expect(lower.lastIndexOf("'dispute'")).toBeGreaterThan(gtIndex);
  });

  // --- Curator-bot suggestion participation (AUB-31) -------------------------
  // By DEFAULT a LIVE suggestion (suggested_by non-null, ZERO votes — the exact
  // rule the "Suggested by Aubrey's Bot" badge derives from via `summarizeClaim`)
  // also matches; `includeSuggested: false` (the `?bot=` param) reverts to the
  // community-evidence-only predicate above.

  it("DEFAULT: a live bot suggestion also matches (suggested_by non-null, zero votes)", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"]);
    const lower = renderSql(predicate as SQL).sql.toLowerCase();

    // The suggestion OR-branch alongside the consensus rule.
    expect(lower).toContain(" or ");
    expect(lower).toContain("suggested_by");
    expect(lower).toContain("is not null");
    // The badge-rule guard: ZERO attestations (confirms + disputes = 0). This is
    // what makes ANY real vote — including a dispute — kill the suggestion match
    // instantly (matching `summarizeClaim`'s `suggested && !hasEvidence`); the
    // listing then matches only via the strict community consensus.
    expect(lower).toMatch(/\+\s*count\(\*\)\s*filter[^)]*\)[^=<>]*=\s*0/);
    // The community strict `>` is still present (the suggestion branch is an OR,
    // never a weakening of the consensus rule).
    expect(lower).toContain(" > ");
  });

  it("includeSuggested=false reverts to community-evidence-only matching", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"], false);
    const lower = renderSql(predicate as SQL).sql.toLowerCase();

    // No suggestion branch at all — exactly the original consensus predicate.
    expect(lower).not.toContain("suggested_by");
    expect(lower).toContain(" > ");
  });
});

// ---------------------------------------------------------------------------
// "Hide bot suggestions" RESULT-SET exclusion (owner bug report)
//
// `?bot=false` used to affect only filter MATCHING, so with no other filter
// active the chip visibly did nothing — bot-suggested listings stayed in the
// results. The exclusion drops bot-suggested-ONLY listings (a live suggestion
// on some visible claim + NO community attestation evidence on ANY visible
// claim — exactly the listings whose card is driven by suggestion alone) from
// the result set. A listing with ANY real evidence stays visible regardless of
// live suggestions (ADR-007: returned-set only, trust derivation untouched).
// ---------------------------------------------------------------------------
describe("buildSuggestedOnlyExclusion — 'Hide bot suggestions' result-set exclusion", () => {
  it("renders NOT(live-suggestion EXISTS AND NOT any-evidence EXISTS), visibility-bounded", () => {
    const { sql, params } = renderSql(buildSuggestedOnlyExclusion());
    const lower = sql.toLowerCase();

    // The overall shape: a negated conjunction of two correlated EXISTS.
    expect(lower).toMatch(/^not \(/);
    expect(lower.match(/exists/g)?.length).toBe(2);
    // Branch 1 — the live-suggestion existence rule (mirrors the badge's
    // `getBotSuggestedListingIds`): a visible claim with `suggested_by` set.
    expect(lower).toContain("suggested_by");
    expect(lower).toContain("is not null");
    // Branch 2 — "any real community evidence": an attestation row joined to a
    // visible claim of the listing. INNER join, so a bare claim row (zero votes)
    // is NOT evidence.
    expect(lower).toContain('inner join "attestations"');
    // The evidence branch is NEGATED inside the conjunction ("and not exists"):
    // exclusion applies only when NO evidence exists anywhere on the listing.
    expect(lower).toContain("and not exists");
    // Visibility (#41): BOTH branches count only `visible` claims.
    expect(params.filter((p) => p === "visible").length).toBe(2);
  });

  // JS mirror of the rendered boolean (kept literal so it can't drift; the
  // structural pin above ties it to the real SQL): a listing is RETURNED iff
  // NOT (has a live suggestion AND has no evidence).
  const returned = (hasLiveSuggestion: boolean, hasAnyEvidence: boolean) =>
    !(hasLiveSuggestion && !hasAnyEvidence);

  it("excludes a bot-suggested-only listing (live suggestion, zero community evidence)", () => {
    expect(returned(true, false)).toBe(false);
  });

  it("keeps a listing with real evidence even when it also carries a live suggestion", () => {
    expect(returned(true, true)).toBe(true);
  });

  it("keeps ordinary listings — evidence-only and no-signal alike — untouched", () => {
    expect(returned(false, true)).toBe(true);
    expect(returned(false, false)).toBe(true);
  });
});

describe("buildBrowseWhere — search + taxonomy composition", () => {
  it("is undefined when neither search nor filters constrain anything", () => {
    expect(buildBrowseWhere(buildSearchPredicate(""), [])).toBeUndefined();
  });

  it("returns just the search predicate when no attributes are selected", () => {
    const where = buildBrowseWhere(buildSearchPredicate("taco"), []);
    expect(where).toBeDefined();
    const lower = renderSql(where as SQL).sql.toLowerCase();
    expect(lower).toContain("ilike");
    expect(lower).not.toContain("exists");
  });

  it("returns just the taxonomy predicate when the search is blank", () => {
    const where = buildBrowseWhere(buildSearchPredicate("  "), ["dedicated_fryer"]);
    expect(where).toBeDefined();
    const lower = renderSql(where as SQL).sql.toLowerCase();
    expect(lower).toContain("exists");
    expect(lower).not.toContain("ilike");
  });

  it("ANDs search and taxonomy together when both are present", () => {
    const where = buildBrowseWhere(buildSearchPredicate("taco"), [
      "dedicated_fryer",
      "celiac_safe_vs_gluten_friendly",
    ]);
    const { sql, params } = renderSql(where as SQL);
    const lower = sql.toLowerCase();

    expect(lower).toContain("ilike");
    expect(lower.match(/exists/g)?.length).toBe(2);
    expect(lower).toContain(" and ");
    // The search term is still bound as the `%term%` wildcard.
    expect(params).toContain("%taco%");
  });

  it("threads includeSuggested=false through to the taxonomy predicate AND adds the exclusion", () => {
    const where = buildBrowseWhere(buildSearchPredicate(""), ["dedicated_fryer"], false);
    const lower = renderSql(where as SQL).sql.toLowerCase();
    expect(lower).toContain("exists");
    // The taxonomy EXISTS carries no suggestion OR-branch (community-evidence-
    // only matching): the ONLY `suggested_by` reference is the result-set
    // exclusion's live-suggestion branch, inside the negated conjunction.
    expect((lower.match(/suggested_by/g) ?? []).length).toBe(1);
    expect(lower).toContain("not (exists");
    expect(lower).toContain('inner join "attestations"');
  });

  it("includeSuggested=false constrains EVEN with no search/attrs (the chip is never a no-op)", () => {
    // The owner bug: with no other filter active, `?bot=false` produced NO
    // predicate at all, so bot-suggested cards stayed visible. Now the bare
    // exclusion alone constrains the browse.
    const where = buildBrowseWhere(buildSearchPredicate(""), [], false);
    expect(where).toBeDefined();
    const lower = renderSql(where as SQL).sql.toLowerCase();
    expect(lower).toContain("not (exists");
    expect(lower).toContain("suggested_by");
  });

  it("default (includeSuggested=true) adds NO exclusion — behavior unchanged", () => {
    // A bare default browse still composes to no WHERE at all…
    expect(buildBrowseWhere(buildSearchPredicate(""), [])).toBeUndefined();
    // …and a filtered default browse carries no result-set exclusion (its only
    // `suggested_by` references are the taxonomy OR-branch, never a `not (exists`).
    const where = buildBrowseWhere(buildSearchPredicate(""), ["dedicated_fryer"], true);
    expect(renderSql(where as SQL).sql.toLowerCase()).not.toContain("not (exists");
  });
});
