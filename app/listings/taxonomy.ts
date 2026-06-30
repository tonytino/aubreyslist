/**
 * The FIXED 7-attribute GF taxonomy — the single, client-safe source of truth
 * (issue #126, domain.md → Discovery / Trust Model).
 *
 * CLIENT-SAFE: a plain `as const` string tuple with NO drizzle/neon/db import,
 * mirroring `app/listings/sort.ts` and `app/listings/distance.ts`. The browse
 * route's filter UI + search-param handling (client bundle) reference THIS, not
 * the drizzle-backed `claimAttributes` from `~/db/schema` — so importing the
 * taxonomy no longer drags `pgEnum`/`pgTable` (and their neon-touching graph)
 * into the client bundle.
 *
 * SINGLE SOURCE OF TRUTH: `db/schema.ts` derives its `claim_attribute` pgEnum
 * from this same tuple, so the enum values stay in lockstep automatically — the
 * DB and the client share ONE ordered list. Keep this file free of any
 * `db`/server-only imports.
 *
 * Order is meaningful: it is the order the attributes appear in the filter UI
 * and the persisted enum. Do not reorder without intent.
 *
 * v1 set (issue #175): the curated five-attribute taxonomy. Two attributes that
 * were ambiguous as a community confirm/dispute — `cross_contamination_protocol`
 * and `staff_knowledge` — were purged before v1 and are tracked for re-introduction
 * with clearer semantics. The headline attribute's enum key is still
 * `celiac_safe_vs_gluten_friendly` for historical reasons, but it is now surfaced
 * simply as "Celiac-safe" (every listing is assumed gluten-free-friendly, so the
 * useful question is just "is it celiac-safe?"). Renaming the key to `celiac_safe`
 * is a deferred follow-up — see `app/trust/summary.ts`.
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
