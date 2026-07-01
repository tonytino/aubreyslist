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
 */
export const SITE_URL = "https://aubreyslist.com";

export const SITE_NAME = "Aubrey's List";

/** Descriptive title used for link previews (the browser tab title stays "Aubrey's List"). */
export const SITE_SOCIAL_TITLE = "Aubrey's List — gluten-free restaurants you can trust";

export const SITE_DESCRIPTION =
  "A community directory of how safe restaurants really are for gluten-free and celiac needs — every listing is contributed, attested, and kept fresh by people who live with the same stakes.";

/** 1200×630 social share card (Open Graph / Twitter summary_large_image). */
export const OG_IMAGE_PATH = "/og-image.png";

/** Resolve a root-relative path to an absolute URL against {@link SITE_URL}. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

type MetaTag =
  | { title: string }
  | { charSet: string }
  | { name: string; content: string }
  | { property: string; content: string };

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
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: SITE_SOCIAL_TITLE },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:url", content: SITE_URL },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME} — gluten-free restaurants you can trust` },

    // Twitter / X.
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: SITE_SOCIAL_TITLE },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    { name: "twitter:image", content: ogImage },
  ];
}
