import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { currentUserQuery } from "~/auth/current-user-query";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { cn } from "~/lib/utils";
import { favoriteListing, unfavoriteListing } from "~/server/favorites/favorites.fn";

interface FavoriteButtonProps {
  listingId: string;
  /** The listing's name, woven into the accessible label ("Save Blue Sparrow"). */
  listingName?: string;
  /**
   * Optional positioning/appearance override. When provided, it REPLACES the
   * default browse-card overlay chrome (the `absolute right-3 top-3 …
   * bg-background/80` styling) so a different surface (e.g. the listing hero) can
   * restyle the button — the disabled-state utilities are always kept. When
   * omitted, the button renders with its exact browse-card styling unchanged.
   */
  className?: string;
}

/**
 * Build the relative post-sign-in `returnTo` for an anonymous save: the CURRENT
 * path plus a `?save=<listingId>` marker, so the OAuth callback lands the diner
 * back where they were with the intent to save preserved (F8a wires the marker).
 *
 * A RELATIVE path only (`/listings/x?save=y`) — the server's `validateReturnTo`
 * rejects anything else. Computed from `window.location`; SSR-safe via the
 * `typeof window` guard (the button hydrates before any anonymous click).
 */
function buildReturnTo(listingId: string): string {
  const marker = `save=${encodeURIComponent(listingId)}`;
  if (typeof window === "undefined") {
    return `/?${marker}`;
  }
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  params.set("save", listingId);
  return `${pathname}?${params.toString()}`;
}

/**
 * The favorite (bookmark) affordance for a listing — a self-contained client
 * island (issue AUB-123 / F5). Drops into the browse card's top-right corner
 * exactly where the previously-inert heart sat.
 *
 * Reads the prefetched `favoriteIdsQuery` + `currentUserQuery` via
 * `useSuspenseQuery` (the repo convention — both are hydrated by the root
 * loader), so the filled/empty state renders correctly on first paint with no
 * `useEffect`/`useState` fetch.
 *
 * SIGNED-IN: an OPTIMISTIC toggle — the `["favorites"]` cache flips immediately
 * on click; a successful write confirms with a direction-aware success toast
 * (favorited vs unfavorited, read from the mutation variable — not the
 * post-invalidation cache); a failed write rolls back to the pre-click snapshot
 * and surfaces an error toast; `onSettled` re-invalidates so the cache
 * reconciles with the server. The button is disabled while the write is in
 * flight.
 *
 * ANONYMOUS: NO write is attempted. The click opens a Radix dialog explaining
 * favorites with a "Sign in" action linking to Google OAuth, carrying a
 * `returnTo` that returns the diner here with a `?save=<listingId>` marker.
 *
 * ACCESSIBILITY (styling.md — never colour alone): `aria-pressed` reflects the
 * favorited state, and the accessible label FLIPS ("Save …" ↔ "Saved — remove
 * …"); the filled heart (`fill-current`) is a redundant cue on top of the label,
 * never the sole signal.
 *
 * CLIENT-SAFE: imports only the client-safe `favorites.fn` seam, the query
 * modules, the UI dialog, and icons — never `~/server/favorites/index` or `db`.
 */
export function FavoriteButton({ listingId, listingName, className }: FavoriteButtonProps) {
  const queryClient = useQueryClient();
  const { data: favoriteIds } = useSuspenseQuery(favoriteIdsQuery);
  const { data: currentUser } = useSuspenseQuery(currentUserQuery);

  const [signInOpen, setSignInOpen] = useState(false);

  const isSignedIn = currentUser != null;
  const isFavorited = new Set(favoriteIds).has(listingId);
  const name = listingName ?? "this spot";

  const toggleFavorite = useMutation({
    mutationFn: (nextFavorited: boolean) =>
      nextFavorited
        ? favoriteListing({ data: { listingId } })
        : unfavoriteListing({ data: { listingId } }),
    onMutate: async (nextFavorited: boolean) => {
      // Cancel any in-flight favorites fetch so it can't clobber our optimistic
      // write, snapshot the current ids for rollback, then flip the cache.
      await queryClient.cancelQueries({ queryKey: favoriteIdsQuery.queryKey });
      const previous = queryClient.getQueryData<string[]>(favoriteIdsQuery.queryKey);
      queryClient.setQueryData<string[]>(favoriteIdsQuery.queryKey, (old) => {
        const ids = old ?? [];
        if (nextFavorited) {
          return ids.includes(listingId) ? ids : [...ids, listingId];
        }
        return ids.filter((id) => id !== listingId);
      });
      return { previous };
    },
    onSuccess: (_data, nextFavorited) => {
      // Direction comes from the mutation variable, not post-invalidation cache
      // state — the cache has already been flipped optimistically by the time
      // this runs, so reading it back would be redundant (and fragile if a
      // concurrent invalidation lands first).
      toast.success(nextFavorited ? "Saved to your spots" : "Removed from your saved spots");
    },
    onError: (_error, _nextFavorited, context) => {
      // Roll back to the pre-click snapshot and tell the diner it didn't stick.
      if (context?.previous !== undefined) {
        queryClient.setQueryData(favoriteIdsQuery.queryKey, context.previous);
      }
      toast.error("Could not update your saved spots. Please try again.");
    },
    onSettled: () => {
      // Reconcile with the server regardless of success/failure.
      queryClient.invalidateQueries({ queryKey: favoriteIdsQuery.queryKey });
    },
  });

  const handleClick = () => {
    if (!isSignedIn) {
      // Anonymous: no write is attempted — explain favorites and offer sign-in.
      setSignInOpen(true);
      return;
    }
    toggleFavorite.mutate(!isFavorited);
  };

  const accessibleLabel = isFavorited ? `Saved — remove ${name}` : `Save ${name}`;
  const signInHref = `/api/auth/google?returnTo=${encodeURIComponent(buildReturnTo(listingId))}`;

  return (
    <>
      <button
        type="button"
        aria-label={accessibleLabel}
        aria-pressed={isFavorited}
        disabled={toggleFavorite.isPending}
        onClick={handleClick}
        className={cn(
          // Default browse-card overlay chrome — replaced wholesale when a caller
          // (e.g. the listing hero) passes its own `className`.
          className ??
            "absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:text-brand",
          // Disabled-while-pending treatment is kept regardless of the override.
          "disabled:pointer-events-none disabled:opacity-60"
        )}
      >
        <Heart className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} aria-hidden="true" />
      </button>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in to save spots</DialogTitle>
            <DialogDescription>
              Favorites let you keep a personal list of gluten-free spots you trust. Sign in to save{" "}
              {name} and find it again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <a href={signInHref}>Sign in</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
