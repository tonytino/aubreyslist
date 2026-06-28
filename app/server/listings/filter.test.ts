import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildBrowseWhere, buildTaxonomyFilterPredicate } from "./filter";
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
});
