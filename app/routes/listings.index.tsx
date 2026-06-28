import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ListingCard } from "~/components/listing/ListingCard";
import { BROWSE_PAGE_SIZE, type BrowseListingsPage } from "~/server/listings/browse";
import { fetchBrowseListings } from "~/server/listings/browse.fn";

/**
 * Browse list — the default Denver discovery view (issue #33, domain.md →
 * Discovery, "list-first"). A page of scannable listing cards, each showing the
 * headline celiac-safe vs. gluten-friendly state and a recent-incident flag at a
 * glance. Open to anonymous visitors (reads are open).
 *
 * The page number lives in the URL (`?page=2`) so the view is linkable and
 * back/forward works. Data is prefetched in the loader and read via
 * `useSuspenseQuery`, so it is dehydrated into the SSR HTML and hydrates with no
 * loading flash (docs/agents/api.md pattern). The trust glance is computed
 * server-side (one batched query set, no N+1) by `fetchBrowseListings`.
 */

const browseSearchSchema = z.object({
  page: z.number().int().min(1).catch(1),
});

function browseQueryOptions(page: number) {
  return queryOptions({
    queryKey: ["browse-listings", page],
    queryFn: () => fetchBrowseListings({ data: { page, pageSize: BROWSE_PAGE_SIZE } }),
  });
}

export const Route = createFileRoute("/listings/")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: async ({ context, deps: { page } }) => {
    await context.queryClient.ensureQueryData(browseQueryOptions(page));
  },
  component: BrowseListings,
});

function BrowseListings() {
  const { page } = Route.useSearch();
  const { data } = useSuspenseQuery(browseQueryOptions(page));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight text-foreground">
          Browse Denver listings
        </h1>
        <p className="text-body text-muted-foreground">
          Restaurants the community is tracking for gluten-free safety. Each card shows what the
          community has attested at a glance — celiac-safe vs. merely gluten-friendly — and flags
          any recent “got glutened” reports. Tap a card for the full trust breakdown.
        </p>
      </header>

      {data.cards.length === 0 ? <BrowseEmptyState /> : <BrowseResults data={data} />}
    </div>
  );
}

function BrowseResults({ data }: { data: BrowseListingsPage }) {
  const showingFrom = (data.page - 1) * data.pageSize + 1;
  const showingTo = (data.page - 1) * data.pageSize + data.cards.length;

  return (
    <>
      <p className="mt-section text-body-sm text-muted-foreground">
        Showing {showingFrom}–{showingTo} of {data.total}
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {data.cards.map((card) => (
          <ListingCard key={card.listing.id} listing={card.listing} glance={card.glance} />
        ))}
      </ul>

      <Pagination data={data} />
    </>
  );
}

function Pagination({ data }: { data: BrowseListingsPage }) {
  const hasPrev = data.page > 1;
  const hasNext = data.hasMore;

  if (!hasPrev && !hasNext) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="mt-section flex items-center justify-between gap-3">
      {hasPrev ? (
        <Link
          to="/listings"
          search={{ page: data.page - 1 }}
          className="inline-flex items-center justify-center rounded-card border border-border px-4 py-2 text-body-sm font-semibold text-foreground hover:bg-surface"
        >
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}

      <span className="text-body-sm text-muted-foreground">Page {data.page}</span>

      {hasNext ? (
        <Link
          to="/listings"
          search={{ page: data.page + 1 }}
          className="inline-flex items-center justify-center rounded-card border border-border px-4 py-2 text-body-sm font-semibold text-foreground hover:bg-surface"
        >
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

/** Honest empty state — no listings yet, never fabricated rows (domain.md). */
function BrowseEmptyState() {
  return (
    <div className="mt-section flex flex-col items-start gap-3 rounded-card border border-dashed border-border bg-surface p-gutter">
      <h2 className="text-title font-semibold text-foreground">No listings yet</h2>
      <p className="text-body text-muted-foreground">
        No restaurants have been added to the Denver directory yet. Be the first — add a place you
        trust (or want the community to vet) and start the trust record.
      </p>
      <Link
        to="/listings/new"
        className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
      >
        Add a listing
      </Link>
    </div>
  );
}
