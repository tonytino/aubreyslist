import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { QuickFilterValue } from "~/listings/quick";
import { DEFAULT_STALENESS_MONTHS } from "~/trust/summary";
import { buildQuickFilterPredicate } from "./quick-filter";

/**
 * The classification rules themselves are unit-tested as pure functions in
 * `app/trust/summary.test.ts` and the freshness formatter. Here we assert
 * their SQL expression — each token becomes a correlated subquery over
 * `listings.id`, and the trust-relevant boundaries (strict `>` for
 * celiac-safe, the staleness cutoff, the recent-incident window) are encoded
 * faithfully so a weakening regression fails here. No live database
 * (docs/agents/testing.md).
 *
 * The vocabulary is `celiac` + `recent` since AUB-295; the retired `friendly`
 * token has no SQL at all (see "retired / unknown tokens" below).
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
      // Visibility + the single headline attribute, bound as params.
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
      // Fresh is inclusive (`>=` the cutoff), matching `isStale`'s edge rule,
      // and a null lastConfirmedAt is treated as fresh (not stale).
      expect(lower).toContain(">=");
      expect(lower).toContain("is null");
    });

    // --- Curator-bot suggestion participation --------------------------------

    it("DEFAULT: a live bot suggestion also matches, with NO freshness bound on it", () => {
      const { lower } = render(
        buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );

      // The suggestion OR-branch: suggested_by non-null and zero votes — the
      // exact badge rule (`summarizeClaim`'s `suggested && !hasEvidence`),
      // via the shared `buildLiveSuggestionHaving` fragment. The zero-votes
      // guard is what makes any real vote (a dispute included) kill the
      // suggestion match; freshness applies only to the community path (a
      // suggestion is dateless provenance — the cutoff comparison sits inside
      // the community branch, not the suggestion branch).
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

  describe("retired / unknown tokens (AUB-295)", () => {
    // `parseQuick` drops unknown tokens before the loader ever reaches here, so
    // these arrive only via a hand-built call. The cast models exactly that:
    // a token outside the live vocabulary.
    const unknown = (token: string) => [token] as unknown as QuickFilterValue[];

    it("builds NO predicate for the retired `friendly` token (an old ?quick=friendly link)", () => {
      // AUB-295 deleted the gluten-friendly safety state and its SQL. A stale
      // shared link must degrade to an unfiltered directory — never to a
      // silently different safety reading, and never to a thrown loader.
      expect(
        buildQuickFilterPredicate(unknown("friendly"), NOW, DEFAULT_STALENESS_MONTHS)
      ).toBeUndefined();
      expect(
        buildQuickFilterPredicate(unknown("friendly"), NOW, DEFAULT_STALENESS_MONTHS, false)
      ).toBeUndefined();
    });

    it("builds NO predicate for any other unknown token", () => {
      expect(
        buildQuickFilterPredicate(unknown("bogus"), NOW, DEFAULT_STALENESS_MONTHS)
      ).toBeUndefined();
    });

    it("ignores an unknown token beside a live one rather than poisoning the filter", () => {
      const mixed = buildQuickFilterPredicate(
        ["celiac", "friendly"] as unknown as QuickFilterValue[],
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      const celiacOnly = buildQuickFilterPredicate(["celiac"], NOW, DEFAULT_STALENESS_MONTHS);
      expect(render(mixed as SQL).sql).toBe(render(celiacOnly as SQL).sql);
    });

    it("emits no gluten-friendly `<=` direction anywhere in the live vocabulary", () => {
      // The contested-direction tally comparison was the whole of the retired
      // token's SQL. Nothing in the surviving vocabulary may resurrect it —
      // a `<=` here would mean some filter affirms a contested claim.
      const { lower } = render(
        buildQuickFilterPredicate(["celiac", "recent"], NOW, DEFAULT_STALENESS_MONTHS) as SQL
      );
      expect(lower).not.toMatch(/'confirm'\)\s*<=\s*count\(\*\)\s*filter/);
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

      // The recency window is expressed as UTC calendar-date bounds (params),
      // not `current_date`, so it is deterministic against the injected `now`.
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

      // Both facets are present: the celiac EXISTS (with its strict `>` tally
      // lock) and the recent NOT EXISTS incident subquery — conjoined, so the
      // result matches listings satisfying both.
      expect(lower).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/); // celiac still strict
      expect(lower).toContain("not exists"); // recent's incident guard
      expect(lower).toContain('from "incidents"');
      // At least two correlated subqueries (celiac exists + recent's fresh
      // exists + incident not-exists) are conjoined.
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
