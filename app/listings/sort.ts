/**
 * Browse sort options — a small, extensible registry.
 *
 * Client-safe: pure data + a tiny parser, shared so the sort control (client)
 * and the browse loader (server) use one source of truth for the option set,
 * labels, default, and `?sort=` parsing. Keep it free of db/server-only
 * imports.
 *
 * The ordering rules each option maps to are defined here (see option `help`)
 * and implemented over the transparent trust signals (confirm/dispute counts
 * + `lastConfirmedAt` recency, ADR-007) in `app/server/listings/browse.ts` —
 * never an opaque score.
 */

/**
 * The ordered registry of browse sorts. Order here is the order shown in the
 * control; the first entry is the default.
 *
 * To add a sort: append an entry here and add the matching ordering branch in
 * `getBrowseListings`. The schema, the union type, and the control all derive
 * from this array.
 */
export const BROWSE_SORT_OPTIONS = [
  {
    value: "alpha",
    label: "Alphabetical (A–Z)",
    help: "Restaurant name, A to Z. The stable, scannable default.",
  },
  {
    value: "trust",
    label: "Most trusted",
    help:
      "Strongest celiac-safe consensus first: by net confirm count " +
      "(confirms minus disputes) on the headline celiac-safe claim, then most " +
      "recently confirmed, then name. A roll-up of visible evidence, not a score.",
  },
  {
    value: "recency",
    label: "Recently confirmed",
    help:
      "Most-recently-confirmed headline celiac-safe claim first, then by net " +
      "confirm count, then name. Listings never confirmed sort last.",
  },
  {
    value: "distance",
    label: "Near me",
    help:
      "Closest first, by great-circle (haversine) distance from your location " +
      "to each listing's coordinates, then name. Requires your browser location; " +
      "if it's denied or unavailable the list falls back to alphabetical.",
  },
] as const;

/** The union of valid `?sort=` tokens, derived from the registry. */
export type BrowseSort = (typeof BROWSE_SORT_OPTIONS)[number]["value"];

/** The stable default sort — alphabetical, the first registry entry. */
export const DEFAULT_BROWSE_SORT: BrowseSort = BROWSE_SORT_OPTIONS[0].value;

/** All valid sort tokens, in display order. */
export const BROWSE_SORT_VALUES: readonly BrowseSort[] = BROWSE_SORT_OPTIONS.map(
  (option) => option.value
);

/** Type guard: is `value` a known sort token? */
export function isBrowseSort(value: unknown): value is BrowseSort {
  return typeof value === "string" && (BROWSE_SORT_VALUES as readonly string[]).includes(value);
}

/**
 * Parse an untrusted `?sort=` value into a known {@link BrowseSort}, falling
 * back to {@link DEFAULT_BROWSE_SORT} for anything unrecognized. Used by the
 * route's search-param schema and the server validator so an unknown token
 * degrades gracefully instead of erroring.
 */
export function parseBrowseSort(value: unknown): BrowseSort {
  return isBrowseSort(value) ? value : DEFAULT_BROWSE_SORT;
}
