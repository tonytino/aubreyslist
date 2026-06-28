import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// `runListingSearch` runs
//   getDb().select().from(listings).where(predicate).orderBy(asc(name)).limit(n).offset(m)
// We model that exact chain so we can assert the predicate handed to `.where()`
// AND the bound `.limit()`/`.offset()` (issue #97) without a live database.
// Everything else (the predicate-building logic) is pure and tested directly.
let returnedRows: unknown[] = [];
const offsetMock = vi.fn((_offset: number) => Promise.resolve(returnedRows));
const limitMock = vi.fn((_limit: number) => ({ offset: offsetMock }));
const orderByMock = vi.fn(() => ({ limit: limitMock }));
const whereMock = vi.fn((_predicate?: SQL) => ({ orderBy: orderByMock }));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
vi.mock("~/db/client", () => ({ getDb: () => ({ select: selectMock }) }));

import {
  SEARCH_PAGE_SIZE,
  buildSearchPredicate,
  listingSearchInputSchema,
  runListingSearch,
} from "./search";

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

// Build a fully-defaulted, validated input the way the server function does, so
// `page`/`pageSize` are always present (the schema defaults apply) without each
// test repeating them. Pass overrides to exercise pagination/clamping.
function search(input: { query: string; page?: number; pageSize?: number }) {
  return runListingSearch(listingSearchInputSchema.parse(input));
}

describe("runListingSearch", () => {
  it("applies the search predicate and returns matching rows", async () => {
    const match = { id: "1", name: "Taco House", address: "1 Main St" };
    returnedRows = [match];

    const result = await search({ query: "taco" });

    expect(result).toEqual([match]);
    // The predicate passed to `.where()` is a real SQL node (not undefined).
    const predicate = whereMock.mock.calls[0]?.[0] as SQL | undefined;
    expect(predicate).toBeDefined();
    // Visibility (#41) is AND-folded first, then the two `%term%` search params.
    expect(renderSql(predicate as SQL).params).toEqual(["visible", "%taco%", "%taco%"]);
  });

  it("returns an empty array when nothing matches", async () => {
    returnedRows = [];
    const result = await search({ query: "nope-no-match" });
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

  it("applies only the visibility filter for an empty query (returns all VISIBLE listings)", async () => {
    returnedRows = [{ id: "1" }, { id: "2" }];

    const result = await search({ query: "  " });

    expect(result).toHaveLength(2);
    // A blank query adds no text constraint, but the public read still excludes
    // hidden/removed listings (#41) — the ONLY bound param is the visibility one.
    const predicate = whereMock.mock.calls[0]?.[0] as SQL | undefined;
    expect(predicate).toBeDefined();
    expect(renderSql(predicate as SQL).params).toEqual(["visible"]);
  });

  it("excludes hidden/removed listings from search results (#41)", async () => {
    // This is a PUBLIC, addressable RPC (mounted via api.$.ts), so hidden/removed
    // listings must never be returned by a name/address search. Assert the WHERE
    // always carries `moderation_status = 'visible'`, AND-folded with the search.
    await search({ query: "taco" });

    const predicate = whereMock.mock.calls[0]?.[0] as SQL;
    const { sql, params } = renderSql(predicate);
    const lower = sql.toLowerCase();
    expect(lower).toContain("moderation_status");
    expect(lower).toContain(" and ");
    expect(params).toContain("visible");
  });

  it("bounds every query with the default page size and offset 0", async () => {
    await search({ query: "taco" });

    expect(limitMock).toHaveBeenCalledWith(SEARCH_PAGE_SIZE);
    expect(offsetMock).toHaveBeenCalledWith(0);
  });

  it("offsets to the requested page (page 2 starts after one full page)", async () => {
    await search({ query: "taco", page: 2, pageSize: 10 });

    expect(limitMock).toHaveBeenCalledWith(10);
    // page 2 with size 10 -> skip the first 10 rows.
    expect(offsetMock).toHaveBeenCalledWith(10);
  });

  it("clamps a too-large page size to the upper bound (rejected by the validator)", () => {
    // The validator caps `pageSize`, so a caller can never request a huge page.
    expect(() => listingSearchInputSchema.parse({ query: "taco", pageSize: 10_000 })).toThrow();
    // The largest accepted page size is the default cap.
    expect(
      listingSearchInputSchema.parse({ query: "taco", pageSize: SEARCH_PAGE_SIZE }).pageSize
    ).toBe(SEARCH_PAGE_SIZE);
  });
});
