import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// `runListingSearch` runs `getDb().select().from(listings).where(predicate)`.
// We model that exact chain so we can assert the predicate handed to `.where()`
// without a live database. Everything else (the predicate-building logic) is
// pure and tested directly.
let returnedRows: unknown[] = [];
const whereMock = vi.fn((_predicate?: SQL) => Promise.resolve(returnedRows));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
vi.mock("~/db/client", () => ({ getDb: () => ({ select: selectMock }) }));

import { buildSearchPredicate, runListingSearch } from "./search";

// Render a drizzle SQL node to a parameterized string so we can assert on the
// generated WHERE clause (table/columns + ILIKE + bound `%term%` params).
const dialect = new PgDialect();
function renderSql(node: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(node);
  return { sql: query.sql, params: query.params };
}

beforeEach(() => {
  returnedRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildSearchPredicate", () => {
  it("returns undefined for an empty query", () => {
    expect(buildSearchPredicate("")).toBeUndefined();
  });

  it("returns undefined for a whitespace-only query", () => {
    expect(buildSearchPredicate("   \t\n ")).toBeUndefined();
  });

  it("ORs a case-insensitive ILIKE over name and address", () => {
    const predicate = buildSearchPredicate("taco");
    expect(predicate).toBeDefined();

    const { sql, params } = renderSql(predicate as SQL);
    expect(sql.toLowerCase()).toContain("ilike");
    expect(sql.toLowerCase()).toContain(" or ");
    expect(sql).toContain('"name"');
    expect(sql).toContain('"address"');
    // Both terms are bound as the same `%term%` wildcard pattern.
    expect(params).toEqual(["%taco%", "%taco%"]);
  });

  it("trims surrounding whitespace before building the pattern", () => {
    const { params } = renderSql(buildSearchPredicate("  taco  ") as SQL);
    expect(params).toEqual(["%taco%", "%taco%"]);
  });
});

describe("runListingSearch", () => {
  it("applies the search predicate and returns matching rows", async () => {
    const match = { id: "1", name: "Taco House", address: "1 Main St" };
    returnedRows = [match];

    const result = await runListingSearch({ query: "taco" });

    expect(result).toEqual([match]);
    // The predicate passed to `.where()` is a real SQL node (not undefined).
    const predicate = whereMock.mock.calls[0]?.[0] as SQL | undefined;
    expect(predicate).toBeDefined();
    expect(renderSql(predicate as SQL).params).toEqual(["%taco%", "%taco%"]);
  });

  it("returns an empty array when nothing matches", async () => {
    returnedRows = [];
    const result = await runListingSearch({ query: "nope-no-match" });
    expect(result).toEqual([]);
  });

  it("matches case-insensitively (ILIKE) regardless of query casing", () => {
    // Casing is handled by ILIKE in Postgres; the builder lowercases nothing
    // itself, so the same wildcard pattern is produced for any casing and the
    // DB does the case-insensitive comparison.
    const upper = renderSql(buildSearchPredicate("TACO") as SQL);
    expect(upper.sql.toLowerCase()).toContain("ilike");
    expect(upper.params).toEqual(["%TACO%", "%TACO%"]);
  });

  it("passes no WHERE filter for an empty query (returns all listings)", async () => {
    returnedRows = [{ id: "1" }, { id: "2" }];

    const result = await runListingSearch({ query: "  " });

    expect(result).toHaveLength(2);
    // `undefined` predicate -> drizzle applies no WHERE -> all rows.
    expect(whereMock.mock.calls[0]?.[0]).toBeUndefined();
  });
});
