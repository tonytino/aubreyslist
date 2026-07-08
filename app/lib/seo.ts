/**
 * Site-wide SEO / social-share metadata.
 *
 * Centralises the canonical origin, the default title/description, and the
 * Open Graph + Twitter Card tags so a shared link (iMessage, Slack, Discord,
 * X/Twitter, Facebook) unfurls with the brand mark, a title, and a description
 * instead of a bare URL. The root route spreads `defaultSeoMeta()` into its
 * head; individual routes can override `title` / `description` (TanStack Router
 * dedupes meta by `title` / `name` / `property`, descendant wins).
 */

/**
 * Canonical production origin — used to build ABSOLUTE URLs for `og:image` and
 * `og:url`, which social scrapers (notably Apple/iMessage) require; relative
 * paths are unreliable. Update this single constant if the domain changes.
 *
 * The live custom domain is the HYPHENATED `www.aubreys-list.com` — that is
 * the host Google indexes (per Search results) and the one attached to the
 * Vercel project. The unhyphenated `aubreyslist.com` (the repo's name) is NOT
 * our domain; do not "fix" the spelling back.
 */
export const SITE_URL = "https://www.aubreys-list.com";

export const SITE_NAME = "Aubrey's List";

/** Descriptive title used for link previews (the browser tab title stays "Aubrey's List"). */
export const SITE_SOCIAL_TITLE = "Aubrey's List: gluten-free restaurants you can trust";

export const SITE_DESCRIPTION =
  "A community directory of gluten-free and celiac-safe restaurants, kept honest by diners who share the need.";

/** 1200×630 social share card (Open Graph / Twitter summary_large_image). */
export const OG_IMAGE_PATH = "/og-image.png";

/**
 * A real square brand logo that ships in `public/` — used as the
 * `Organization` logo in the site JSON-LD (a square mark reads better there than
 * the wide OG card). Must stay in sync with an asset that actually exists.
 */
export const LOGO_PATH = "/icon-512.png";

/** Resolve a root-relative path to an absolute URL against {@link SITE_URL}. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

type MetaTag =
  | { title: string }
  | { charSet: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** A canonical `<link>` descriptor (belongs in `head().links`, not meta). */
export type CanonicalLink = { rel: "canonical"; href: string };

/**
 * The per-page meta a specific route should OVERRIDE on top of the root
 * defaults: document `title` + `description`, and the matching Open Graph /
 * Twitter Card tags. TanStack Router dedupes meta by `title` / `name` /
 * `property` (descendant wins), so spreading this into a route's `head().meta`
 * cleanly overrides the root's defaults. `og:url` is ABSOLUTE (via
 * {@link absoluteUrl}) because social scrapers require it.
 */
export function pageSeoMeta({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): MetaTag[] {
  const url = absoluteUrl(path);
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

/**
 * The canonical link for a page. Canonical is a `<link rel="canonical">`, so it
 * belongs in `head().links`, not `head().meta`. Href is absolute.
 */
export function canonicalLink(path: string): CanonicalLink {
  return { rel: "canonical", href: absoluteUrl(path) };
}

/**
 * Serialize a JSON-LD payload to a string safe to embed inside a
 * `<script type="application/ld+json">` block. Escaping `<` as its `<`
 * unicode form means a `<` in any string value (e.g. a restaurant name) can
 * never open a `</script>` sequence and break out of the tag — the single XSS
 * risk with inlined structured data. `JSON.stringify` already escapes quotes.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** A JSON-LD `<script>` descriptor for TanStack Start's `head().scripts`. */
export function jsonLdScript(data: unknown): {
  type: "application/ld+json";
  children: string;
} {
  return { type: "application/ld+json", children: serializeJsonLd(data) };
}

/**
 * Site-level structured data injected once at the root: a `WebSite` (with a
 * `SearchAction` pointing at the directory's `?q=` search) and an
 * `Organization` (name, url, square logo). Only honest, site-wide facts — no
 * per-page or invented data.
 */
export function siteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: SITE_NAME,
        url: SITE_URL,
        logo: absoluteUrl(LOGO_PATH),
      },
    ],
  };
}

/**
 * The default document + social meta tags for the whole site. Spread into the
 * root route's `head().meta`. Routes may append/override their own `title` and
 * `description`.
 */
export function defaultSeoMeta(): MetaTag[] {
  const ogImage = absoluteUrl(OG_IMAGE_PATH);
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: SITE_NAME },
    { name: "description", content: SITE_DESCRIPTION },
    { name: "theme-color", content: "#6d28d9" },

    // Open Graph — Facebook, iMessage, Slack, Discord, LinkedIn.
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "en_US" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: SITE_SOCIAL_TITLE },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:url", content: SITE_URL },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME}: gluten-free restaurants you can trust` },

    // Twitter / X.
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: SITE_SOCIAL_TITLE },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    { name: "twitter:image", content: ogImage },
  ];
}
