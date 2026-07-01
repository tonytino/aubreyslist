import type { RestaurantCardVM } from "~/components/listing/ListingCard";

/**
 * Client-side quick-chip filtering for the directory route (AUB-61, Phase 2b).
 *
 * Free-text search is SERVER-SIDE (URL-driven `?q=`, covering ALL listings, not
 * just the loaded page — so the count + no-results state stay honest, and a match
 * on page 2 is found). The three mutually-exclusive "quick" chips filter by
 * DERIVED trust state, which isn't expressed in SQL, so they stay CLIENT-side over
 * the current server result set. Keeping this as a pure function makes the
 * (safety-relevant) filter logic unit-testable without mounting the route.
 *
 * Because the quick chips refine only the SHOWN results (not the whole table),
 * the route must present their count honestly — as "N of the results shown", not
 * as the grand total (see the route's count copy).
 *
 * PURE + CLIENT-SAFE: operates only on the flat {@link RestaurantCardVM}s already
 * mapped from the server page — no `db`/server import, no re-derivation of trust.
 */

/**
 * The active quick chip, or `null` for none. Mutually exclusive (a single value),
 * matching the bundle:
 * - `celiac`   → only celiac-safe cards
 * - `friendly` → only gluten-friendly cards
 * - `recent`   → only cards whose freshness cue is `fresh` (recently verified)
 */
export type QuickFilter = "celiac" | "friendly" | "recent" | null;

/** Whether a card passes the active quick chip (always true when none is set). */
function matchesQuick(vm: RestaurantCardVM, quick: QuickFilter): boolean {
  switch (quick) {
    case "celiac":
      return vm.safetyState === "celiac-safe";
    case "friendly":
      return vm.safetyState === "gluten-friendly";
    case "recent":
      return vm.freshness?.kind === "fresh";
    default:
      return true;
  }
}

/**
 * Filter the current result set's cards by the active quick chip. A `null` chip
 * returns the set unchanged. Text search is NOT applied here — it runs
 * server-side via `?q=` so it covers every listing, not just the loaded page.
 */
export function filterByQuick(
  cards: readonly RestaurantCardVM[],
  quick: QuickFilter
): RestaurantCardVM[] {
  if (quick === null) {
    return [...cards];
  }
  return cards.filter((vm) => matchesQuick(vm, quick));
}
