import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  canonicalLink,
  defaultSeoMeta,
  jsonLdScript,
  LOGO_PATH,
  OG_IMAGE_PATH,
  pageSeoMeta,
  SITE_ALTERNATE_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  serializeJsonLd,
  siteJsonLd,
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

  it("declares the Open Graph locale", () => {
    expect(prop("og:locale")?.content).toBe("en_US");
  });
});

describe("pageSeoMeta", () => {
  const meta = pageSeoMeta({
    title: "Example Spot · Aubrey's List",
    description: "A community-vetted gluten-free spot.",
    path: "/listings/abc123",
  });

  const named = (name: string) =>
    meta.find((t) => "name" in t && t.name === name) as { content: string } | undefined;
  const prop = (property: string) =>
    meta.find((t) => "property" in t && t.property === property) as { content: string } | undefined;

  it("overrides the document title and description", () => {
    expect(meta.some((t) => "title" in t && t.title === "Example Spot · Aubrey's List")).toBe(true);
    expect(named("description")?.content).toBe("A community-vetted gluten-free spot.");
  });

  it("mirrors the title/description into Open Graph and Twitter tags", () => {
    expect(prop("og:title")?.content).toBe("Example Spot · Aubrey's List");
    expect(prop("og:description")?.content).toBe("A community-vetted gluten-free spot.");
    expect(named("twitter:title")?.content).toBe("Example Spot · Aubrey's List");
    expect(named("twitter:description")?.content).toBe("A community-vetted gluten-free spot.");
  });

  it("emits an ABSOLUTE og:url built from the path", () => {
    expect(prop("og:url")?.content).toBe(`${SITE_URL}/listings/abc123`);
    expect(prop("og:url")?.content).toMatch(/^https:\/\//);
  });
});

describe("canonicalLink", () => {
  it("returns a canonical link with an absolute href", () => {
    expect(canonicalLink("/about")).toEqual({
      rel: "canonical",
      href: `${SITE_URL}/about`,
    });
  });
});

describe("serializeJsonLd", () => {
  it("produces valid JSON that round-trips", () => {
    const json = serializeJsonLd({ a: 1, b: "two" });
    expect(JSON.parse(json)).toEqual({ a: 1, b: "two" });
  });

  it("escapes '<' so it cannot break out of a <script> tag", () => {
    const json = serializeJsonLd({ name: "Bread </script><script>alert(1)" });
    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c");
    // Still valid JSON that decodes back to the original string.
    expect(JSON.parse(json)).toEqual({ name: "Bread </script><script>alert(1)" });
  });
});

describe("breadcrumbJsonLd", () => {
  it("emits an ordered BreadcrumbList with absolute item URLs", () => {
    const data = breadcrumbJsonLd([
      { name: "Aubrey's List", path: "/" },
      { name: "Example Spot", path: "/listings/abc123" },
    ]);
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Aubrey's List", item: `${SITE_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Example Spot",
        item: `${SITE_URL}/listings/abc123`,
      },
    ]);
  });
});

describe("jsonLdScript", () => {
  it("wraps serialized JSON-LD as an application/ld+json script descriptor", () => {
    const script = jsonLdScript({ "@type": "Thing" });
    expect(script.type).toBe("application/ld+json");
    expect(JSON.parse(script.children)).toEqual({ "@type": "Thing" });
  });
});

describe("siteJsonLd", () => {
  const data = siteJsonLd();
  const graph = data["@graph"] as Array<Record<string, unknown>>;

  it("declares the schema.org context", () => {
    expect(data["@context"]).toBe("https://schema.org");
  });

  it("includes a WebSite with a ?q= SearchAction target", () => {
    const website = graph.find((n) => n["@type"] === "WebSite");
    expect(website?.name).toBe(SITE_NAME);
    expect(website?.alternateName).toEqual(SITE_ALTERNATE_NAMES);
    expect(website?.url).toBe(SITE_URL);
    const action = website?.potentialAction as Record<string, unknown>;
    expect(action["@type"]).toBe("SearchAction");
    expect((action.target as Record<string, unknown>).urlTemplate).toBe(
      `${SITE_URL}/?q={search_term_string}`
    );
    expect(action["query-input"]).toBe("required name=search_term_string");
  });

  it("includes an Organization with an absolute logo URL", () => {
    const org = graph.find((n) => n["@type"] === "Organization");
    expect(org?.name).toBe(SITE_NAME);
    expect(org?.url).toBe(SITE_URL);
    expect(org?.logo).toBe(absoluteUrl(LOGO_PATH));
  });
});
