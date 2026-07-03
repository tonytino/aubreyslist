/**
 * The directory's "quick filter" vocabulary — the three mutually-exclusive
 * prebuilt filters surfaced as chips (Celiac-safe / Gluten-friendly / Recently
 * verified).
 *
 * URL-driven (`?quick=`) and applied SERVER-side (AUB-135): a chip persists
 * across refresh / back-forward / share, and the count + pagination stay honest
 * (the filter constrains the query, not just the loaded page). The SQL EXPRESSION
 * of each token lives in `app/server/listings/quick-filter.ts`; the mapping to the
 * displayed safety glance is:
 *   - `celiac`   → `safetyState === "celiac-safe"`   (fresh, uncontested confirm-majority)
 *   - `friendly` → `safetyState === "gluten-friendly"` (contested: disputes tie/lead)
 *   - `recent`   → `freshness.kind === "fresh"`      (a within-window confirmation, no recent incident)
 *
 * CLIENT-SAFE + pure: no db/server imports, so the client (schema + chips) and the
 * server (the SQL predicate builder) share this ONE definition of the vocabulary —
 * mirroring the co-located `sort.ts` / `distance.ts` param modules.
 */

/** The quick-filter tokens, in chip order. The single source of the vocabulary. */
export const QUICK_FILTER_VALUES = ["celiac", "friendly", "recent"] as const;

/** One quick-filter token (never `null`). */
export type QuickFilterValue = (typeof QUICK_FILTER_VALUES)[number];

/** The active quick chip, or `null` for none (mutually exclusive — a single value). */
export type QuickFilter = QuickFilterValue | null;
