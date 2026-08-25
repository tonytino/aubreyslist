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
 * The matching rule (positive consensus: confirms strictly outnumber
 * disputes) is unit-tested directly in `app/trust/summary.test.ts`
 * (`hasPositiveConsensus`). Here we assert its SQL expression: each selected
 * attribute becomes a correlated `EXISTS` consensus subquery, multiple
 * attributes AND together, and the builder composes with the text search
 * predicate — all without a live database (docs/agents/testing.md).
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
    // Only `visible` claims count toward consensus, so a hidden/removed
    // claim can never make a listing match the filter.
    expect(lower).toContain("moderation_status");
    expect(params).toContain("visible");
  });

  it("AND-combines one EXISTS per attribute for a multi-attribute selection", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer", "celiac_safe"]);
    const { sql, params } = renderSql(predicate as SQL);
    const lower = sql.toLowerCase();

    // Two EXISTS subqueries, AND-joined.
    expect(lower.match(/exists/g)?.length).toBe(2);
    expect(lower).toContain(" and ");
    // One bound attribute parameter per selected attribute.
    expect(params).toContain("dedicated_fryer");
    expect(params).toContain("celiac_safe");
  });

  it("de-duplicates a repeated attribute into a single EXISTS", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer", "dedicated_fryer"]);
    const { sql } = renderSql(predicate as SQL);
    expect(sql.toLowerCase().match(/exists/g)?.length).toBe(1);
  });

  // --- Consensus direction lock (strict `>`, not `>=`) -----------------------
  // The single trust-critical rule the SQL encodes: a claim qualifies only
  // when confirms strictly outnumber disputes (`hasPositiveConsensus`). A
  // `>=` drift would let a tie read as affirmed — overstating safety, which
  // can hurt a celiac. These assert the rendered SQL keeps the strict `>` so
  // a `>=` regression fails here, mirroring the pure-JS
  // `hasPositiveConsensus` cases in `app/trust/summary.test.ts`.

  it("encodes the STRICT confirms-greater-than-disputes consensus (HAVING confirms > disputes)", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"]);
    const lower = renderSql(predicate as SQL).sql.toLowerCase();

    // The HAVING compares the two conditional tallies with a strict `>`.
    expect(lower).toContain("having");
    // Strict greater-than, not `>=` — a tie must not qualify (contested ≠ affirmed).
    expect(lower).toContain(">");
    expect(lower).not.toContain(">=");
    // Both sides of the comparison are present: confirms vs disputes.
    expect(lower).toContain("'confirm'");
    expect(lower).toContain("'dispute'");
    // The comparison puts the `filter (where … = 'confirm')` tally left of
    // `>` and the `'dispute'` tally right — confirms > disputes, not the
    // inverse — asserted by where each literal falls around the `>`.
    const gtIndex = lower.indexOf(" > ");
    expect(gtIndex).toBeGreaterThan(-1);
    expect(lower.indexOf("'confirm'")).toBeLessThan(gtIndex);
    expect(lower.lastIndexOf("'dispute'")).toBeGreaterThan(gtIndex);
  });

  // --- Curator-bot suggestion participation ----------------------------------
  // By default a live suggestion (suggested_by non-null, zero votes — the
  // exact rule the "Suggested by Aubrey's Bot" badge derives from via
  // `summarizeClaim`) also matches; `includeSuggested: false` (the `?bot=`
  // param) reverts to the community-evidence-only predicate above.

  it("DEFAULT: a live bot suggestion also matches (suggested_by non-null, zero votes)", () => {
    const predicate = buildTaxonomyFilterPredicate(["dedicated_fryer"]);
    const lower = renderSql(predicate as SQL).sql.toLowerCase();

    // The suggestion OR-branch alongside the consensus rule.
    expect(lower).toContain(" or ");
    expect(lower).toContain("suggested_by");
    expect(lower).toContain("is not null");
    // The badge-rule guard: zero attestations (confirms + disputes = 0). This
    // is what makes any real vote — a dispute included — kill the suggestion
    // match instantly (matching `summarizeClaim`'s `suggested &&
    // !hasEvidence`); the listing then matches only via strict community
    // consensus.
    expect(lower).toMatch(/\+\s*count\(\*\)\s*filter[^)]*\)[^=<>]*=\s*0/);
    // The community strict `>` is still present (the suggestion branch is an
    // OR, never a weakening of the consensus rule).
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
// "Hide bot suggestions" result-set exclusion
//
// The exclusion drops bot-suggested-only listings (a live suggestion on some
// visible claim + no community attestation evidence on any visible claim —
// exactly the listings whose card is driven by suggestion alone) from the
// result set, so the chip constrains even an otherwise unfiltered browse. A
// listing with any real evidence stays visible regardless of live suggestions
// (ADR-007: returned-set only, trust derivation untouched).
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
    // Branch 2 — "any real community evidence": an attestation row joined to
    // a visible claim of the listing. Inner join, so a bare claim row (zero
    // votes) is not evidence.
    expect(lower).toContain('inner join "attestations"');
    // The evidence branch is negated inside the conjunction ("and not
    // exists"): exclusion applies only when no evidence exists anywhere.
    expect(lower).toContain("and not exists");
    // Both branches count only `visible` claims.
    expect(params.filter((p) => p === "visible").length).toBe(2);
  });

  // JS mirror of the rendered boolean (kept literal so it can't drift; the
  // structural pin above ties it to the real SQL): a listing is returned iff
  // not (has a live suggestion and has no evidence).
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
      "celiac_safe",
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
    // The taxonomy EXISTS carries no suggestion OR-branch
    // (community-evidence-only matching): the only `suggested_by` reference
    // is the result-set exclusion's live-suggestion branch, inside the
    // negated conjunction.
    expect((lower.match(/suggested_by/g) ?? []).length).toBe(1);
    expect(lower).toContain("not (exists");
    expect(lower).toContain('inner join "attestations"');
  });

  it("includeSuggested=false constrains EVEN with no search/attrs (the chip is never a no-op)", () => {
    // With no other filter active, the bare exclusion alone must constrain
    // the browse — the chip is never a visible no-op.
    const where = buildBrowseWhere(buildSearchPredicate(""), [], false);
    expect(where).toBeDefined();
    const lower = renderSql(where as SQL).sql.toLowerCase();
    expect(lower).toContain("not (exists");
    expect(lower).toContain("suggested_by");
  });

  it("default (includeSuggested=true) adds NO exclusion — behavior unchanged", () => {
    // A bare default browse composes to no WHERE at all…
    expect(buildBrowseWhere(buildSearchPredicate(""), [])).toBeUndefined();
    // …and a filtered default browse carries no result-set exclusion (its
    // only `suggested_by` references are the taxonomy OR-branch, never a
    // `not (exists`).
    const where = buildBrowseWhere(buildSearchPredicate(""), ["dedicated_fryer"], true);
    expect(renderSql(where as SQL).sql.toLowerCase()).not.toContain("not (exists");
  });
});
