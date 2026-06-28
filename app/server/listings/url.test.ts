import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./url";

/**
 * Tests for the http(s)-scheme guard shared by the add-listing intake validator
 * and the listing detail render sink (#90). No DB/network — pure string logic.
 */
describe("isHttpUrl", () => {
  it("accepts http and https URLs (case-insensitive scheme)", () => {
    expect(isHttpUrl("https://example.com/menu")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("HTTPS://example.com")).toBe(true);
  });

  it("rejects dangerous schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    // A scheme-relative or relative URL is not an absolute http(s) link either.
    expect(isHttpUrl("//evil.example")).toBe(false);
    expect(isHttpUrl("/relative/path")).toBe(false);
  });

  it("is total for nullish / empty input (never throws)", () => {
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});
