import { describe, expect, it } from "vitest";
import {
  OG_IMAGE_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  defaultSeoMeta,
} from "./seo";

describe("absoluteUrl", () => {
  it("resolves a root-relative path against the canonical origin", () => {
    expect(absoluteUrl("/og-image.png")).toBe(`${SITE_URL}/og-image.png`);
  });

  it("returns an absolute https URL", () => {
    expect(absoluteUrl(OG_IMAGE_PATH)).toMatch(/^https:\/\//);
  });
});

describe("defaultSeoMeta", () => {
  const meta = defaultSeoMeta();

  const named = (name: string) =>
    meta.find((t) => "name" in t && t.name === name) as { content: string } | undefined;
  const prop = (property: string) =>
    meta.find((t) => "property" in t && t.property === property) as { content: string } | undefined;

  it("sets the document title, description, and theme-color", () => {
    expect(meta.some((t) => "title" in t && t.title === SITE_NAME)).toBe(true);
    expect(named("description")?.content).toBe(SITE_DESCRIPTION);
    expect(named("theme-color")?.content).toBe("#6d28d9");
  });

  it("includes Open Graph tags with an absolute image URL", () => {
    expect(prop("og:type")?.content).toBe("website");
    expect(prop("og:site_name")?.content).toBe(SITE_NAME);
    expect(prop("og:description")?.content).toBe(SITE_DESCRIPTION);
    expect(prop("og:url")?.content).toBe(SITE_URL);
    expect(prop("og:image")?.content).toBe(absoluteUrl(OG_IMAGE_PATH));
    expect(prop("og:image:width")?.content).toBe("1200");
    expect(prop("og:image:height")?.content).toBe("630");
    expect(prop("og:image:alt")?.content).toContain(SITE_NAME);
  });

  it("includes a Twitter summary_large_image card with the same absolute image", () => {
    expect(named("twitter:card")?.content).toBe("summary_large_image");
    expect(named("twitter:image")?.content).toBe(absoluteUrl(OG_IMAGE_PATH));
    expect(named("twitter:description")?.content).toBe(SITE_DESCRIPTION);
  });
});
