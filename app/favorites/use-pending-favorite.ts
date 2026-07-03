import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { currentUserQuery } from "~/auth/current-user-query";
import { favoriteListing } from "~/server/favorites/favorites.fn";
import { favoriteIdsQuery } from "./favorites-query";

/**
 * Auto-save a "pending favorite" after sign-in (issue AUB-124 / F8b).
 *
 * The anonymous FavoriteButton flow carries the listing the user wanted to save
 * through Google's OAuth round-trip as a `?save=<listingId>` marker on the
 * `returnTo` path (see F8a). When the user lands back signed in, this hook reads
 * that marker, fires {@link favoriteListing} exactly once, strips the marker
 * from the URL, and invalidates the `["favorites"]` query so the heart reflects
 * the new state.
 *
 * This is a side-effect-on-navigation (imperative URL rewrite + a one-shot
 * mutation), NOT data fetching — so a `useEffect` is the right tool here (the
 * Hard Rule forbids `useEffect`+`useState` for DATA FETCHING; the favorite write
 * is a mutation, and the auth/favorite reads go through TanStack Query).
 */

// Module-level guard: listing ids we've already auto-saved this session. Living
// at module scope (not a ref) means it survives component remounts, re-renders,
// re-navigation (back/forward re-landing on the marker) and React strict-mode's
// double-invoke — so a repeated `?save=<id>` never triggers a second client
// write. The server fn is idempotent too, but the client must not fire twice.
const savedListingIds = new Set<string>();

/** Test-only: reset the one-shot guard between cases. */
export function __resetPendingFavoriteGuard(): void {
  savedListingIds.clear();
}

/** Read a non-empty `save` listing id from a location search string, else null. */
function readSaveParam(searchStr: string): string | null {
  const value = new URLSearchParams(searchStr).get("save");
  return value && value.length > 0 ? value : null;
}

/**
 * Strip ONLY the `save` param from the current URL via `history.replaceState`,
 * preserving the path, hash, and any other query params. Does not add a history
 * entry (replace, not push), so Back still returns to the pre-sign-in page.
 */
function stripSaveParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("save");
  const query = url.searchParams.toString();
  const next = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

export function usePendingFavorite(): void {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const { data: user } = useSuspenseQuery(currentUserQuery);
  const queryClient = useQueryClient();

  useEffect(() => {
    const listingId = readSaveParam(searchStr);
    // No marker, or the viewer isn't signed in → leave the marker untouched and
    // write nothing (an anon return keeps `?save=` for a later signed-in return).
    if (!listingId || !user) {
      return;
    }
    // Already handled this id (remount / re-nav / strict-mode) → don't re-write.
    if (savedListingIds.has(listingId)) {
      return;
    }
    savedListingIds.add(listingId);

    // Fire the one-shot write, then drop the marker so a refresh can't re-trigger
    // it. Strip immediately (the write is in flight); refresh the favorites query
    // once it settles so the heart flips. The write is idempotent server-side;
    // either way the diner gets feedback via toast rather than a silently
    // swallowed failure.
    void favoriteListing({ data: { listingId } })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: favoriteIdsQuery.queryKey });
        toast.success("Saved to your spots");
      })
      .catch(() => {
        toast.error("Could not save the spot. Please try again.");
      });
    stripSaveParam();
  }, [searchStr, user, queryClient]);
}

/**
 * Headless handler mounted once at the root so the pending-favorite side effect
 * runs on every return from sign-in. Renders nothing.
 */
export function PendingFavoriteHandler(): null {
  usePendingFavorite();
  return null;
}
