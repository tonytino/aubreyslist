/**
 * The fixed GF taxonomy — the single, client-safe source of truth
 * (domain.md → Discovery / Trust Model).
 *
 * Client-safe: a plain `as const` string tuple with no drizzle/neon/db
 * import. The browse route's filter UI + search-param handling reference
 * this, not the drizzle-backed `claimAttributes` from `~/db/schema`, so
 * importing the taxonomy never drags the neon-touching graph into the client
 * bundle.
 *
 * `db/schema.ts` derives its `claim_attribute` pgEnum from this tuple, so the
 * DB and the client share one ordered list automatically. Keep this file free
 * of db/server-only imports.
 *
 * Order is meaningful: it is the order the attributes appear in the filter UI
 * and the persisted enum. Do not reorder without intent.
 *
 * The headline attribute's enum key is `celiac_safe_vs_gluten_friendly`, but
 * it is surfaced simply as "Celiac-safe" (every listing is assumed
 * gluten-free-friendly, so the useful question is "is it celiac-safe?"). The
 * key is persisted — do not rename it; see `app/trust/summary.ts`.
 */
export const CLAIM_ATTRIBUTES = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "gf_substitutes",
] as const;

/** String-union of the GF taxonomy attributes (e.g. for exhaustive label maps). */
export type ClaimAttribute = (typeof CLAIM_ATTRIBUTES)[number];
