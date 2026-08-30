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

/**
 * Which surface the control is drawn on. Each entry owns a box, a fill, and a
 * saved-heart ink tuned to that surface's backdrop, so the count can be painted
 * legibly wherever the control appears.
 *
 * A named surface is the ONLY way to get a counted control. Free-form
 * `className` stays an appearance escape hatch with no count: an arbitrary box
 * cannot promise room for a number or contrast for its ink, and a count
 * announced with nothing on screen is its own defect. A new counted surface
 * earns an entry here, with its ratios checked.
 */
export type FavoriteSurface = "card" | "hero";

interface FavoriteSurfaceStyle {
  /** Box, fill, and focus ring. */
  chrome: string;
  /** Extra inline padding once a count widens the box into a pill. */
  counted: string;
  /** The saved heart's fill colour against this surface's backdrop. */
  savedInk: string;
}

/**
 * Chrome for a heart floating on a media tile — the browse card and the map
 * mini-card both draw it. `h-9` + `min-w-9` is the shared box: an uncounted
 * heart is a 36px circle and a counted one grows sideways into a pill of the
 * same height, so the tile's right rail holds still. Compose with `cn` to shift
 * it (`cn(FAVORITE_OVERLAY_CHROME, "top-2")`) — but note that passing it as
 * `className` suppresses the count, so a card lets the default surface apply.
 */
export const FAVORITE_OVERLAY_CHROME =
  "absolute right-3 top-3 z-10 inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";

/**
 * Chrome for the listing hero's icon rail — a translucent dark chip with a light
 * border, over an arbitrary photo. Exported because the sibling flag control
 * shares the rail: one appearance, so the two chips cannot drift apart.
 *
 * The fill is `black/65`, not lighter: the counted pill paints white TEXT here,
 * and over a pure-white photo a lighter chip drops that text under the 4.5:1 AA
 * floor. `h-10` + `min-w-10` keeps a lone glyph a 40px circle while letting the
 * counted heart grow sideways, so both chips stay the same height.
 */
export const FAVORITE_HERO_CHROME =
  "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full border border-white/40 bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-0 motion-reduce:transition-none [&_svg]:size-5";

const FAVORITE_SURFACES: Record<FavoriteSurface, FavoriteSurfaceStyle> = {
  card: {
    chrome: FAVORITE_OVERLAY_CHROME,
    counted: "px-2.5",
    // Brand purple on the translucent neutral pill: >= 3.6:1 in both themes.
    savedInk: "text-brand-strong",
  },
  hero: {
    chrome: FAVORITE_HERO_CHROME,
    counted: "px-3",
    // The rail is pinned dark in both themes, so the saved ink is pinned light:
    // the pastel end of the same brand hue reads >= 5.4:1 on `black/65` over any
    // photo, where either `brand` token would fall far under the 3:1 floor.
    savedInk: "text-accent-lavender",
  },
};

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
   * Honoured on a named {@link FavoriteSurface} only — see {@link FavoriteSurface}
   * for why free-form `className` never counts.
   *
   * ADR-007: a community signal, never a safety verdict — hence the plain
   * neutral chrome (no safety colour) and the "not a safety score" tooltip.
   */
  saveCount?: number | undefined;
  /** Which surface's chrome to draw. Defaults to the card overlay. */
  surface?: FavoriteSurface;
  /**
   * Free-form appearance override. Replaces the surface chrome entirely and
   * suppresses the count; the disabled-state utilities are always kept. Reach
   * for a {@link FavoriteSurface} first.
   */
  className?: string;
}

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
 * drawn on the browse card, the map mini-card, and the listing hero's icon rail.
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
 * the count into the accessible name, identically on every named
 * {@link FavoriteSurface}. The count is a community signal, not a safety score,
 * so the pill borrows no safety colour and carries the ADR-007 tooltip saying
 * exactly that.
 *
 * Client-safe: imports only the `favorites.fn` seam, query modules, dialog, and
 * icons — never `~/server/favorites/index` or `db`.
 */
export function FavoriteButton({
  listingId,
  listingName,
  saveCount,
  surface = "card",
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

  // The count belongs to a surface that reserved room and ink for it. Free-form
  // chrome sizes for a bare glyph, so the count leaves the render and the
  // accessible name in one step and the two can never disagree.
  const style = className === undefined ? FAVORITE_SURFACES[surface] : null;
  const showCount = style !== null && saveCount !== undefined && saveCount > 0;
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
        className ?? style?.chrome,
        // The count's own breathing room, only when there is a count.
        showCount ? style?.counted : "",
        // Disabled-while-pending treatment is kept regardless of the override.
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      {/* The saved fill takes the surface's own brand ink, which sits on the
          glyph rather than the button so a hover cannot repaint a saved heart.
          Free-form chrome owns its palette, so there the fill inherits.
          Redundant either way: `aria-pressed` and the accessible name carry the
          state without colour. */}
      <Heart
        className={cn(
          "h-4 w-4 shrink-0",
          isFavorited && "fill-current",
          isFavorited && style?.savedInk
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
