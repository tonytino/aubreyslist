import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises `buildSitemapXml` directly with a mocked `~/db/client`, not the
 * route's `GET` handler through a mounted router — no live DB or router-tree
 * wiring needed to assert the XML shape.
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<{ id: string }>,
    lastWhere: undefined as unknown,
  };
  const findManyMock = vi.fn((args: { where?: unknown }) => {
    state.lastWhere = args.where;
    return Promise.resolve(state.rows);
  });
  return { state, findManyMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ query: { listings: { findMany: h.findManyMock } } }),
}));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildSitemapXml } from "./sitemap";

const { state } = h;
const dialect = new PgDialect();

beforeEach(() => {
  state.rows = [];
  state.lastWhere = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildSitemapXml (AUB-161)", () => {
  it("emits a well-formed XML document with the static public pages", async () => {
    state.rows = [];

    const xml = await buildSitemapXml();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("</urlset>");
    expect(xml).toContain("<loc>https://www.aubreys-list.com/</loc>");
    expect(xml).toContain("<loc>https://www.aubreys-list.com/about</loc>");

    // Excludes auth-gated/admin routes — never advertise them to a crawler.
    expect(xml).not.toContain("/favorites");
    expect(xml).not.toContain("/listings/new");
    expect(xml).not.toContain("/admin");
  });

  it("includes an absolute /listings/$id URL for every visible listing", async () => {
    state.rows = [{ id: "listing-1" }, { id: "listing-2" }];

    const xml = await buildSitemapXml();

    expect(xml).toContain("<loc>https://www.aubreys-list.com/listings/listing-1</loc>");
    expect(xml).toContain("<loc>https://www.aubreys-list.com/listings/listing-2</loc>");
  });

  it("constrains the listing query to moderation_status = 'visible'", async () => {
    state.rows = [];

    await buildSitemapXml();

    expect(state.lastWhere).toBeDefined();
    const query = dialect.sqlToQuery(state.lastWhere as SQL);
    expect(query.sql.toLowerCase()).toContain("moderation_status");
    expect(query.params).toContain("visible");
  });

  it("escapes XML-special characters (e.g. a raw '&') in a listing id", async () => {
    // `URL#toString()` percent-encodes most XML-unsafe characters (`<`, `"`)
    // itself, but leaves a bare `&` in the path untouched — exactly the case
    // `escapeXml` exists to catch before it lands inside `<loc>`.
    state.rows = [{ id: "a&b" }];

    const xml = await buildSitemapXml();

    expect(xml).toContain("<loc>https://www.aubreys-list.com/listings/a&amp;b</loc>");
    expect(xml).not.toContain("<loc>https://www.aubreys-list.com/listings/a&b</loc>");
  });
});
