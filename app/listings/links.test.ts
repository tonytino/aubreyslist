import { describe, expect, it } from "vitest";
import {
  LINK_KIND_METADATA,
  LINK_KINDS,
  listingLinkInputSchema,
  listingLinksInputSchema,
  listListingLinksInputSchema,
  removeListingLinkInputSchema,
  saveListingLinkInputSchema,
} from "./links";

/**
 * Unit tests for the CLIENT-SAFE typed-link taxonomy + schemas (AUB-202). The
 * URL rules must match the intake guard they supersede (#90): http(s) only, so
 * a dangerous-scheme URL can never be persisted and later rendered into an
 * anchor `href`.
 */

describe("LINK_KINDS taxonomy", () => {
  it("is the fixed five-kind tuple, in render order", () => {
    expect(LINK_KINDS).toEqual([
      "menu",
      "gluten_free_menu",
      "website",
      "reservations",
      "online_ordering",
    ]);
  });

  it("has display metadata (label + hint) for every kind", () => {
    for (const kind of LINK_KINDS) {
      expect(LINK_KIND_METADATA[kind].label).toBeTruthy();
      expect(LINK_KIND_METADATA[kind].hint).toBeTruthy();
    }
  });

  it("keeps the 'No uploads.' promise on the menu field hint (ADR-008)", () => {
    expect(LINK_KIND_METADATA.menu.hint).toContain("No uploads.");
  });
});

describe("listingLinkInputSchema — one typed link", () => {
  it("accepts an https URL for every kind", () => {
    for (const kind of LINK_KINDS) {
      expect(
        listingLinkInputSchema.safeParse({ kind, url: "https://example.com/page" }).success
      ).toBe(true);
    }
  });

  it("accepts an http URL", () => {
    expect(
      listingLinkInputSchema.safeParse({ kind: "menu", url: "http://example.com" }).success
    ).toBe(true);
  });

  it("rejects a javascript: scheme URL (#90 stored-XSS vector)", () => {
    expect(
      listingLinkInputSchema.safeParse({ kind: "menu", url: "javascript:alert(document.cookie)" })
        .success
    ).toBe(false);
  });

  it("rejects a data: scheme URL", () => {
    expect(
      listingLinkInputSchema.safeParse({ kind: "website", url: "data:text/html,<script>" }).success
    ).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(listingLinkInputSchema.safeParse({ kind: "menu", url: "not a url" }).success).toBe(
      false
    );
  });

  it("rejects an empty URL", () => {
    expect(listingLinkInputSchema.safeParse({ kind: "menu", url: "" }).success).toBe(false);
  });

  it("rejects a URL over 2048 characters", () => {
    const url = `https://example.com/${"a".repeat(2048)}`;
    expect(listingLinkInputSchema.safeParse({ kind: "menu", url }).success).toBe(false);
  });

  it("rejects a kind outside the taxonomy", () => {
    expect(
      listingLinkInputSchema.safeParse({ kind: "tiktok", url: "https://example.com" }).success
    ).toBe(false);
  });
});

describe("listingLinksInputSchema — the per-listing set", () => {
  it("accepts an empty array", () => {
    expect(listingLinksInputSchema.safeParse([]).success).toBe(true);
  });

  it("accepts one link per kind (the full set)", () => {
    const links = LINK_KINDS.map((kind) => ({ kind, url: `https://example.com/${kind}` }));
    expect(listingLinksInputSchema.safeParse(links).success).toBe(true);
  });

  it("rejects a duplicate kind (one link per kind in v1)", () => {
    const links = [
      { kind: "menu", url: "https://example.com/a" },
      { kind: "menu", url: "https://example.com/b" },
    ];
    expect(listingLinksInputSchema.safeParse(links).success).toBe(false);
  });

  it("rejects more entries than there are kinds", () => {
    const links = [...LINK_KINDS, "menu"].map((kind, index) => ({
      kind,
      url: `https://example.com/${index}`,
    }));
    expect(listingLinksInputSchema.safeParse(links).success).toBe(false);
  });

  it("rejects a set containing one bad-scheme URL", () => {
    const links = [
      { kind: "menu", url: "https://example.com/menu" },
      { kind: "website", url: "javascript:alert(1)" },
    ];
    expect(listingLinksInputSchema.safeParse(links).success).toBe(false);
  });
});

describe("server-write input schemas", () => {
  it("saveListingLinkInputSchema requires a non-empty listingId", () => {
    expect(
      saveListingLinkInputSchema.safeParse({ listingId: "", kind: "menu", url: "https://x.test" })
        .success
    ).toBe(false);
    expect(
      saveListingLinkInputSchema.safeParse({
        listingId: "l-1",
        kind: "menu",
        url: "https://x.test",
      }).success
    ).toBe(true);
  });

  it("removeListingLinkInputSchema validates listingId + kind (no URL)", () => {
    expect(removeListingLinkInputSchema.safeParse({ listingId: "l-1", kind: "menu" }).success).toBe(
      true
    );
    expect(removeListingLinkInputSchema.safeParse({ listingId: "l-1", kind: "nope" }).success).toBe(
      false
    );
  });

  it("listListingLinksInputSchema rejects an empty listingId", () => {
    expect(listListingLinksInputSchema.safeParse({ listingId: "" }).success).toBe(false);
    expect(listListingLinksInputSchema.safeParse({ listingId: "l-1" }).success).toBe(true);
  });
});
