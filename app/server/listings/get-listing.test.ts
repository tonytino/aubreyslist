import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader uses `getDb().query.listings.findFirst({ where })`; the mock
 * models that chain and captures the `where` to assert this public read
 * constrains to a visible listing — a hidden/removed listing reads like a
 * non-existent one (null, so the route 404s). No live DB needed.
 */

const h = vi.hoisted(() => {
  const state = {
    result: undefined as unknown,
    lastWhere: undefined as unknown,
  };
  const findFirstMock = vi.fn((args: { where?: unknown }) => {
    state.lastWhere = args.where;
    return Promise.resolve(state.result);
  });
  return { state, findFirstMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ query: { listings: { findFirst: h.findFirstMock } } }),
}));

import { getListing } from "./get-listing";

const { state } = h;
const dialect = new PgDialect();

beforeEach(() => {
  state.result = undefined;
  state.lastWhere = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getListing — visibility-aware public read (#41)", () => {
  it("constrains the query to id AND moderation_status = 'visible'", async () => {
    state.result = { id: "listing-1", name: "Acme GF" };

    await getListing({ id: "listing-1" });

    expect(state.lastWhere).toBeDefined();
    const query = dialect.sqlToQuery(state.lastWhere as SQL);
    const lower = query.sql.toLowerCase();
    expect(lower).toContain('"id"');
    expect(lower).toContain("moderation_status");
    expect(lower).toContain(" and ");
    expect(query.params).toContain("listing-1");
    expect(query.params).toContain("visible");
  });

  it("returns the listing when one matches", async () => {
    const row = { id: "listing-1", name: "Acme GF" };
    state.result = row;
    expect(await getListing({ id: "listing-1" })).toBe(row);
  });

  it("returns null when no VISIBLE listing matches (hidden/removed → 404)", async () => {
    // A hidden/removed listing fails the visibility predicate: findFirst
    // yields undefined, the loader returns null, and the route 404s — a
    // moderated-away listing is unreachable by direct link.
    state.result = undefined;
    expect(await getListing({ id: "listing-1" })).toBeNull();
  });
});
