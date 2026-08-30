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
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { cn } from "~/lib/utils";
import { favoriteListing, unfavoriteListing } from "~/server/favorites/favorites.fn";

interface FavoriteButtonProps {
  listingId: string;
  /** The listing's name, woven into the accessible label ("Save Blue Sparrow"). */
  listingName?: string;
  /**
   * The listing's PUBLIC save count — how many people have saved it, not this
   * diner's own state. Absent or 0 keeps the circular heart; a positive count
   * widens the same control into a pill carrying "heart + 24", so one control
   * states both the diner's save action and the community's count.
   *
   * Honoured only on the default chrome. A caller supplying its own `className`
   * sizes the box for a bare glyph, so the count is dropped from the render AND
   * from the accessible name together — an announced count with nothing on
   * screen is its own defect.
   *
   * ADR-007: a community signal, never a safety verdict — hence the plain
   * neutral overlay chrome (no safety colour) and the "not a safety score"
   * tooltip below.
   */
  saveCount?: number | undefined;
  /**
   * Optional positioning/appearance override. When provided, it replaces
   * {@link FAVORITE_OVERLAY_CHROME} so another surface (e.g. the listing hero)
   * can restyle the button; the disabled-state utilities are always kept.
   */
  className?: string;
}

/**
 * The overlay chrome for a heart floating on a media tile — the browse card and
 * the map mini-card both draw it, so both import it rather than restating it.
 * `h-9` + `min-w-9` is the shared box: an uncounted heart is a 36px circle and a
 * counted one grows sideways into a pill of the same height, so the tile's right
 * rail holds still. Compose with `cn` to shift it (`cn(FAVORITE_OVERLAY_CHROME,
 * "top-2")`); passing it as `className` suppresses the count, so the browse card
 * lets the default apply instead.
 */
export const FAVORITE_OVERLAY_CHROME =
  "absolute right-3 top-3 z-10 inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";

/**
 * The one wording for the merged control's accessible name. The count is part
 * of the name, never tooltip- or sight-only (styling.md): "Save Blue Sparrow.
 * 24 saves" / "Saved, remove Blue Sparrow. 24 saves". A sentence break, not a
 * comma, so the personal action and the community count stay two separate
 * statements when read aloud, and the action stays FIRST — it is what the
 * control does. Singular at one ("1 save"), never a machine-shaped "1 saves".
 */
function favoriteAccessibleName(
  name: string,
  isFavorited: boolean,
  saveCount?: number | undefined
): string {
  const action = isFavorited ? `Saved, remove ${name}` : `Save ${name}`;
  if (saveCount === undefined || saveCount <= 0) return action;
  return `${action}. ${saveCount} save${saveCount === 1 ? "" : "s"}`;
}

/**
 * Build the relative post-sign-in `returnTo` for an anonymous save: the current path
 * plus a `?save=<listingId>` marker, so the OAuth callback lands the diner back where
 * they were with the intent to save preserved.
 *
 * A relative path only (`/listings/x?save=y`) — the server's `validateReturnTo`
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
 * The favorite (bookmark) affordance for a listing — a self-contained client island
 * in the browse card's top-right corner.
 *
 * Reads the prefetched `favoriteIdsQuery` + `currentUserQuery` via `useSuspenseQuery`
 * (both hydrated by the root loader), so the filled/empty state renders correctly on
 * first paint with no effect-driven fetch.
 *
 * Signed-in: an optimistic toggle — the `["favorites"]` cache flips immediately;
 * success confirms with a direction-aware toast (read from the mutation variable, not
 * the post-invalidation cache); failure rolls back to the pre-click snapshot;
 * `onSettled` re-invalidates so the cache reconciles with the server. The button is
 * disabled while the write is in flight.
 *
 * Anonymous: no write is attempted. The click opens a dialog with a "Sign in" action
 * carrying a `returnTo` that returns the diner here with a `?save=<listingId>` marker.
 *
 * Accessibility (styling.md — never colour alone): `aria-pressed` reflects the state
 * and the accessible label flips ("Save …" ↔ "Saved, remove …"); the filled heart is
 * a redundant cue, never the sole signal.
 *
 * Save count: a positive {@link FavoriteButtonProps.saveCount} widens this same
 * control into a pill — heart + number, with no visible "saves" word — and folds
 * the count into the accessible name. The count is a community signal, not a
 * safety score, so the pill keeps the neutral overlay chrome (never a safety
 * colour) and carries the ADR-007 tooltip saying exactly that.
 *
 * Client-safe: imports only the `favorites.fn` seam, query modules, dialog, and
 * icons — never `~/server/favorites/index` or `db`.
 */
export function FavoriteButton({
  listingId,
  listingName,
  saveCount,
  className,
}: FavoriteButtonProps) {
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
      // Direction comes from the mutation variable — the cache was already flipped
      // optimistically, and reading it back is fragile if a concurrent invalidation
      // lands first.
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

  // The count belongs to the default chrome's box. A caller's own chrome sizes
  // for a bare glyph, so the count leaves the render and the accessible name in
  // one step and the two can never disagree.
  const defaultChrome = className === undefined;
  const showCount = defaultChrome && saveCount !== undefined && saveCount > 0;
  const accessibleLabel = favoriteAccessibleName(
    name,
    isFavorited,
    showCount ? saveCount : undefined
  );
  const signInHref = `/api/auth/google?returnTo=${encodeURIComponent(buildReturnTo(listingId))}`;

  const control = (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={isFavorited}
      disabled={toggleFavorite.isPending}
      onClick={handleClick}
      className={cn(
        className ?? FAVORITE_OVERLAY_CHROME,
        // The count's own breathing room, only when there is a count.
        showCount ? "px-2.5" : "",
        // Disabled-while-pending treatment is kept regardless of the override.
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      {/* The saved fill takes the brand purple on the overlay chrome, where the
          translucent neutral pill can carry it (>= 3.6:1 in both themes, WCAG
          1.4.11). The colour sits on the glyph, not the button, so a hover does
          not repaint a saved heart. A caller's own chrome owns its palette (the
          hero's white-on-black rail), so there the fill inherits. Redundant
          either way: `aria-pressed` and the accessible name carry the state. */}
      <Heart
        className={cn(
          "h-4 w-4 shrink-0",
          isFavorited && "fill-current",
          isFavorited && defaultChrome && "text-brand-strong"
        )}
        aria-hidden="true"
      />
      {showCount ? (
        // Number only — no visible "saves" word (owner decision). The meaning
        // rides on the glyph + count + the accessible name above, and
        // `aria-hidden` keeps AT from hearing the bare digits twice.
        <span
          data-testid="save-count"
          aria-hidden="true"
          className="text-caption font-semibold tabular-nums"
        >
          {saveCount}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      {showCount ? (
        // ADR-007: the count is community activity, not a safety score. The
        // clarifier is supplementary — the visible glyph + number and the
        // accessible name already carry the whole meaning.
        <Tooltip>
          <TooltipTrigger asChild>{control}</TooltipTrigger>
          <TooltipContent>Community saves, not a safety score.</TooltipContent>
        </Tooltip>
      ) : (
        control
      )}

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in to save spots</DialogTitle>
            <DialogDescription>Sign in to save {name} and find it again later.</DialogDescription>
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
