import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { currentUserQuery } from "~/auth/current-user-query";
import { DirectoryList } from "~/components/directory/DirectoryList";
import { listingToCardVM } from "~/components/listing/ListingCard";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { viewerFavoritesQuery } from "~/favorites/viewer-favorites-query";
import { canonicalLink, pageSeoMeta } from "~/lib/seo";

/**
 * `/favorites` — the signed-in viewer's saved spots.
 *
 * The loader prefetches the viewer's favorites and the favorited-id set the
 * cards' heart buttons read, so the page dehydrates into the SSR HTML and
 * hydrates with no loading flash. The current-user query is prefetched at the
 * root and read from cache.
 *
 * Three states, decided by the prefetched auth + favorites:
 *  - anonymous → an empty state inviting sign-in (a full-page OAuth anchor
 *    whose `returnTo` brings the diner back here after login);
 *  - signed-in, empty → a "nothing saved yet" nudge back to the directory;
 *  - signed-in, populated → the shared {@link DirectoryList} of cards, mapped
 *    via `listingToCardVM` with no distance (favorites have no origin) but
 *    with the public save-count so the pill renders exactly as on browse.
 */
export const Route = createFileRoute("/favorites")({
  head: () => ({
    meta: [
      ...pageSeoMeta({
        title: "Your saved spots · Aubrey's List",
        description:
          "The gluten-free and celiac-safe spots you've saved on Aubrey's List, with the same community trust signals as the directory.",
        path: "/favorites",
      }),
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [canonicalLink("/favorites")],
  }),
  loader: async ({ context }) => {
    // Prefetch the viewer's favorites and the favorited-id set the cards'
    // heart buttons read, so the page hydrates fully marked with no client
    // round-trip (anonymous viewers short-circuit both to `[]`, no DB hit).
    await Promise.all([
      context.queryClient.ensureQueryData(viewerFavoritesQuery),
      context.queryClient.ensureQueryData(favoriteIdsQuery),
    ]);
  },
  component: FavoritesPage,
});

export function FavoritesPage() {
  // Auth is prefetched at the root; favorites are prefetched by this route's
  // loader — both read from cache via suspense with no client fetch.
  const { data: user } = useSuspenseQuery(currentUserQuery);
  const { data: favorites } = useSuspenseQuery(viewerFavoritesQuery);

  return (
    // `pb-16` because the shared `DirectoryList` grid carries no bottom
    // padding of its own; this page has no FAB to clear, so it only needs
    // breathing room between the last card and the footer.
    <div className="mx-auto w-full max-w-[96rem] px-gutter pb-16 pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight text-foreground">Saved spots</h1>
        <p className="text-lead text-muted-foreground">
          Gluten-free places you've saved to find again later.
        </p>
      </header>

      <div className="mt-section">
        {user === null ? (
          <FavoritesEmptyState
            title="Sign in to save spots"
            body="Keep a personal list of gluten-free spots you trust. Sign in to start saving."
            action={
              // Full-page OAuth redirect (not an RPC), returning the diner here.
              <a
                href="/api/auth/google?returnTo=/favorites"
                className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
              >
                Sign in with Google
              </a>
            }
          />
        ) : favorites.length === 0 ? (
          <FavoritesEmptyState
            title="No saved spots yet"
            body="Tap the heart on any listing to save it here."
            action={
              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
              >
                Browse listings
              </Link>
            }
          />
        ) : (
          <DirectoryList
            cards={favorites.map((card) =>
              // No distance origin for favorites; pass the save-count so the
              // pill renders exactly as on browse.
              listingToCardVM(card.listing, card.glance, undefined, card.favoriteCount)
            )}
          />
        )}
      </div>
    </div>
  );
}

/** A centered empty-state card: icon + heading + body + a single call to action. */
function FavoritesEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-card border border-border bg-card px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-lavender/50 text-foreground">
        <Heart aria-hidden className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-title font-semibold text-foreground">{title}</h2>
        <p className="text-body text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}
