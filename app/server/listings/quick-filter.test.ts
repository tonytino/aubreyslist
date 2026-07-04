import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_STALENESS_MONTHS } from "~/trust/summary";
import { buildQuickFilterPredicate } from "./quick-filter";

/**
 * Unit tests for the prebuilt quick-filter SQL predicate (AUB-135).
 *
 * The classification RULES themselves are unit-tested as pure functions in
 * `app/trust/summary.test.ts` (`deriveHeadlineSafetyState`) and the freshness
 * formatter. Here we assert the SQL EXPRESSION of those rules — that each token
 * becomes a correlated subquery over `listings.id` and, critically, that the
 * trust-relevant BOUNDARIES (strict `>` for celiac-safe, `<=` for gluten-friendly,
 * the staleness cutoff, and the recent-incident window) are encoded faithfully so a
 * weakening regression fails here. No live database (docs/agents/testing.md).
 */

const NOW = new Date("2026-06-28T00:00:00Z");
const dialect = new PgDialect();
function render(node: SQL): { sql: string; lower: string; params: unknown[] } {
  const query = dialect.sqlToQuery(node);
  return { sql: query.sql, lower: query.sql.toLowerCase(), params: query.params };
}

describe("buildQuickFilterPredicate", () => {
  it("returns undefined when the selection is empty", () => {
    expect(buildQuickFilterPredicate([], NOW, DEFAULT_STALENESS_MONTHS)).toBeUndefined();
  });

  describe("celiac (safetyState === 'celiac-safe')", () => {
    it("is a correlated EXISTS over the visible celiac claim, confirms > disputes AND fresh", () => {
      const predicate = buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS);
      expect(predicate).toBeDefined();
      const { lower, params } = render(predicate as SQL);

      expect(lower).toContain("exists");
      expect(lower).toContain('from "claims"');
      expect(lower).toContain('left join "attestations"');
      expect(lower).toContain("group by");
      expect(lower).toContain("having");
      expect(lower).toContain("'confirm'");
      expect(lower).toContain("'dispute'");
      // Visibility (#41) + the single headline attribute, bound as params.
      expect(lower).toContain("moderation_status");
      expect(params).toContain("visible");
      expect(params).toContain("celiac_safe_vs_gluten_friendly");
      // Freshness cutoff is bound as a Date param (staleness boundary).
      expect(params.some((p) => p instanceof Date)).toBe(true);
    });

    it("LOCK: uses a STRICT confirms > disputes (a tie is contested, never celiac-safe)", () => {
      const { lower } = render(
        buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );
      // The strict `>` compares the confirm tally (left) to the dispute tally
      // (right): `count(*) filter (… 'confirm') > count(*) filter (… 'dispute')`.
      // The tally-structured regex resists a refactor that reshapes the operands.
      expect(lower).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/);
      expect(lower).not.toMatch(/'confirm'\)\s*>=\s*count\(\*\)\s*filter/); // NOT a tie-including `>=`
      // Fresh is INCLUSIVE (`>=` the cutoff), matching `isStale`'s edge rule, and a
      // null lastConfirmedAt is treated as fresh (not stale).
      expect(lower).toContain(">=");
      expect(lower).toContain("is null");
    });

    // --- Curator-bot suggestion participation (AUB-31) -----------------------

    it("DEFAULT: a live bot suggestion also matches, with NO freshness bound on it", () => {
      const { lower } = render(
        buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );

      // The suggestion OR-branch: suggested_by non-null AND zero votes — the
      // EXACT badge rule (`summarizeClaim`'s `suggested && !hasEvidence`), via
      // the shared `buildLiveSuggestionHaving` fragment. The zero-votes guard is
      // what makes any real vote (including a dispute) kill the suggestion
      // match; freshness applies only to the community path (a suggestion is
      // dateless provenance — the cutoff comparison sits inside the community
      // branch, not the suggestion branch).
      expect(lower).toContain(" or ");
      expect(lower).toContain("suggested_by");
      expect(lower).toContain("is not null");
      expect(lower).toMatch(/\+\s*count\(\*\)\s*filter[^)]*\)[^=<>]*=\s*0/);
      // The community strict `>` + inclusive freshness bound are untouched.
      expect(lower).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/);
      expect(lower).toContain(">=");
    });

    it("includeSuggested=false reverts celiac to community-evidence-only matching", () => {
      const { lower } = render(
        buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS, false) as SQL
      );
      expect(lower).not.toContain("suggested_by");
      expect(lower).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/);
    });
  });

  describe("friendly (safetyState === 'gluten-friendly')", () => {
    it("LOCK: has evidence AND confirms <= disputes (contested / dispute-majority)", () => {
      const predicate = buildQuickFilterPredicate(["friendly"], NOW, DEFAULT_STALENESS_MONTHS);
      const { lower, params } = render(predicate as SQL);

      expect(lower).toContain("exists");
      expect(lower).toContain("having");
      // hasEvidence: at least one attestation.
      expect(lower).toContain("> 0");
      // The direction lock: `count(… 'confirm') <= count(… 'dispute')` — disputes
      // tie or outnumber confirms → gluten-friendly (contested, never affirmed).
      expect(lower).toMatch(/'confirm'\)\s*<=\s*count\(\*\)\s*filter/);
      expect(params).toContain("celiac_safe_vs_gluten_friendly");
      expect(params).toContain("visible");
    });

    it("ignores the suggestion flag: a bot suggestion asserts celiac-safe, never the contested reading", () => {
      // Matching `friendly` via a suggestion would fabricate a "gluten-friendly
      // only" verdict the bot never made — the flag must not change this SQL.
      const withFlag = render(
        buildQuickFilterPredicate(["friendly"], NOW, DEFAULT_STALENESS_MONTHS, true) as SQL
      );
      const withoutFlag = render(
        buildQuickFilterPredicate(["friendly"], NOW, DEFAULT_STALENESS_MONTHS, false) as SQL
      );
      expect(withFlag.sql).toBe(withoutFlag.sql);
      expect(withFlag.lower).not.toContain("suggested_by");
    });
  });

  describe("recent (freshness.kind === 'fresh')", () => {
    it("requires a fresh confirmation AND no recent visible incident", () => {
      const predicate = buildQuickFilterPredicate(["recent"], NOW, DEFAULT_STALENESS_MONTHS);
      const { lower, params } = render(predicate as SQL);

      // A within-window confirmation: non-null lastConfirmedAt on/after the cutoff.
      expect(lower).toContain("exists");
      expect(lower).toContain("is not null");
      expect(lower).toContain(">=");
      expect(params.some((p) => p instanceof Date)).toBe(true);

      // The incident cue outranks freshness → NOT EXISTS a recent visible incident.
      expect(lower).toContain("not exists");
      expect(lower).toContain('from "incidents"');
      expect(lower).toContain("occurred_on");
      expect(lower).toContain("moderation_status");

      // The recency window is expressed as UTC calendar-date bounds (params), NOT
      // `current_date`, so it is deterministic against the injected `now`.
      const dateParams = params.filter(
        (p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p)
      );
      expect(dateParams).toContain("2026-06-28"); // today (UTC)
      expect(dateParams).toContain("2026-03-30"); // today − 90 days (UTC)
    });

    it("ignores the suggestion flag: a suggestion is not a verification", () => {
      // "Recently verified" is a freshness claim about real confirmations; a
      // dateless bot suggestion can never satisfy it — the flag must not change
      // this SQL.
      const withFlag = render(
        buildQuickFilterPredicate(["recent"], NOW, DEFAULT_STALENESS_MONTHS, true) as SQL
      );
      const withoutFlag = render(
        buildQuickFilterPredicate(["recent"], NOW, DEFAULT_STALENESS_MONTHS, false) as SQL
      );
      expect(withFlag.sql).toBe(withoutFlag.sql);
      expect(withFlag.lower).not.toContain("suggested_by");
    });
  });

  describe("faceted composition (AUB-140)", () => {
    it("AND-composes each selected token's subquery (celiac + recent)", () => {
      const predicate = buildQuickFilterPredicate(
        ["celiac", "recent"],
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      const { lower } = render(predicate as SQL);

      // Both facets are present: the celiac EXISTS (with its strict `>` tally lock)
      // AND the recent NOT EXISTS incident subquery — conjoined, so the result
      // matches listings satisfying BOTH.
      expect(lower).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/); // celiac still strict
      expect(lower).toContain("not exists"); // recent's incident guard
      expect(lower).toContain('from "incidents"');
      // At least two correlated subqueries (celiac exists + recent's fresh exists +
      // incident not-exists) are conjoined.
      expect((lower.match(/exists/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it("is order-independent: [recent, celiac] renders the same SQL as [celiac, recent]", () => {
      const a = render(
        buildQuickFilterPredicate(["celiac", "recent"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );
      const b = render(
        buildQuickFilterPredicate(["recent", "celiac"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );
      expect(b.sql).toBe(a.sql);
    });
  });
});
