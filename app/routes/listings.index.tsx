import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ListingCard } from "~/components/listing/ListingCard";
import { TaxonomyFilter } from "~/components/listing/TaxonomyFilter";
import { type ClaimAttribute, claimAttributes } from "~/db/schema";
import {
  BROWSE_SORT_OPTIONS,
  BROWSE_SORT_VALUES,
  type BrowseSort,
  DEFAULT_BROWSE_SORT,
} from "~/listings/sort";
import { BROWSE_PAGE_SIZE, type BrowseListingsPage } from "~/server/listings/browse";
import { fetchBrowseListings } from "~/server/listings/browse.fn";

/**
 * Browse list — the default Denver discovery view (issue #33, domain.md →
 * Discovery, "list-first"). A page of scannable listing cards, each showing the
 * headline celiac-safe vs. gluten-friendly state and a recent-incident flag at a
 * glance. Open to anonymous visitors (reads are open).
 *
 * URL-DRIVEN STATE. Both the page number (`?page=2`) and the GF taxonomy filter
 * (`?attrs=dedicated_fryer,celiac_safe_vs_gluten_friendly`, #35) live in the URL
 * so the view is linkable/shareable, SSR-friendly, and back/forward works. The
 * filter resets to page 1 whenever the selection changes. Data is prefetched in
 * the loader and read via `useSuspenseQuery`, so it is dehydrated into the SSR
 * HTML and hydrates with no loading flash (docs/agents/api.md). The trust glance
 * and the consensus-based filtering are computed server-side (one batched query
 * set, no N+1) by `fetchBrowseListings`.
 */

/**
 * Parse the `?attrs=` string into a de-duplicated list of valid taxonomy
 * attributes. The param is a COMMA-SEPARATED list (e.g.
 * `?attrs=dedicated_fryer,celiac_safe_vs_gluten_friendly`) — shareable and
 * human-readable, mirroring `?page=`. Unknown/garbage values are dropped (not an
 * error) so a hand-edited URL degrades gracefully to the valid subset.
 *
 * Kept as a single STRING in the URL (rather than a router-serialized array) so
 * the encoding stays the clean comma form and not URL-encoded JSON.
 */
function parseAttrs(value: string): ClaimAttribute[] {
  const valid = new Set<ClaimAttribute>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if ((claimAttributes as readonly string[]).includes(token)) {
      valid.add(token as ClaimAttribute);
    }
  }
  return [...valid];
}

/** Serialize a selection back to the canonical comma-separated `?attrs=` value. */
function serializeAttrs(attrs: readonly ClaimAttribute[]): string {
  return attrs.join(",");
}

const browseSearchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  /** Comma-separated taxonomy attributes (#35); defaults to "" (no filter). */
  attrs: z.string().catch("").default(""),
  // `?sort=` mirrors the `?page=` URL-param pattern (#36): linkable, back/forward
  // works. A plain enum (NOT a `.transform()`) so the value round-trips cleanly
  // when the router re-serializes search state on navigation; unknown/garbage
  // tokens degrade to the stable alphabetical default via `.catch`.
  sort: z.enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]]).catch(DEFAULT_BROWSE_SORT),
});

function browseQueryOptions(page: number, attrs: ClaimAttribute[], sort: BrowseSort) {
  return queryOptions({
    queryKey: ["browse-listings", page, attrs, sort],
    queryFn: () => fetchBrowseListings({ data: { page, pageSize: BROWSE_PAGE_SIZE, attrs, sort } }),
  });
}

export const Route = createFileRoute("/listings/")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search: { page, attrs, sort } }) => ({ page, attrs, sort }),
  loader: async ({ context, deps: { page, attrs, sort } }) => {
    await context.queryClient.ensureQueryData(browseQueryOptions(page, parseAttrs(attrs), sort));
  },
  component: BrowseListings,
});

function BrowseListings() {
  const { page, attrs: attrsParam, sort } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const attrs = parseAttrs(attrsParam);
  const { data } = useSuspenseQuery(browseQueryOptions(page, attrs, sort));

  const hasFilters = attrs.length > 0;

  // Toggling a filter always resets to page 1 — the old page may not exist under
  // the narrower (or wider) result set, and starting at the top is least
  // surprising. The current sort is preserved (filter and sort are orthogonal).
  function toggleAttribute(attribute: ClaimAttribute) {
    const next = attrs.includes(attribute)
      ? attrs.filter((a) => a !== attribute)
      : [...attrs, attribute];
    navigate({ search: { page: 1, attrs: serializeAttrs(next), sort } });
  }

  function clearFilters() {
    navigate({ search: { page: 1, attrs: "", sort } });
  }

  // Changing the sort also resets to page 1 (a page index is meaningless across
  // a re-ordering) and preserves the active filter selection.
  function changeSort(next: BrowseSort) {
    navigate({ search: { page: 1, attrs: attrsParam, sort: next } });
  }

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

      <div className="mt-section flex flex-col gap-4">
        <TaxonomyFilter selected={attrs} onToggle={toggleAttribute} onClear={clearFilters} />
        <SortControl sort={sort} onChange={changeSort} />
      </div>

      {data.cards.length === 0 ? (
        <BrowseEmptyState hasFilters={hasFilters} onClear={clearFilters} />
      ) : (
        <BrowseResults data={data} attrs={attrs} />
      )}
    </div>
  );
}

/**
 * URL-driven sort control (#36). An accessible, labeled `<select>` — selection,
 * not colour, conveys state (styling.md). Changing it navigates to the same
 * route with the new `?sort=` and RESETS to page 1 (the previous page index is
 * meaningless under a new order) while PRESERVING the active filter, mirroring
 * the `?page=`/`?attrs=` URL-param pattern.
 *
 * Options come from the shared `BROWSE_SORT_OPTIONS` registry, so #37's
 * `distance` option appears here automatically once added there.
 */
function SortControl({
  sort,
  onChange,
}: {
  sort: BrowseSort;
  onChange: (next: BrowseSort) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="browse-sort" className="text-body-sm font-medium text-foreground">
        Sort by
      </label>
      <select
        id="browse-sort"
        value={sort}
        onChange={(event) => onChange(event.target.value as BrowseSort)}
        className="rounded-card border border-border bg-surface px-3 py-2 text-body-sm font-medium text-foreground focus-visible:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {BROWSE_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function BrowseResults({ data, attrs }: { data: BrowseListingsPage; attrs: ClaimAttribute[] }) {
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

      <Pagination data={data} attrs={attrs} />
    </>
  );
}

function Pagination({ data, attrs }: { data: BrowseListingsPage; attrs: ClaimAttribute[] }) {
  const hasPrev = data.page > 1;
  const hasNext = data.hasMore;
  const attrsParam = serializeAttrs(attrs);

  if (!hasPrev && !hasNext) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="mt-section flex items-center justify-between gap-3">
      {hasPrev ? (
        <Link
          to="/listings"
          search={{ page: data.page - 1, attrs: attrsParam, sort: data.sort }}
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
          search={{ page: data.page + 1, attrs: attrsParam, sort: data.sort }}
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

/**
 * Honest empty state (domain.md — never fabricate rows). Distinguishes two
 * cases: a filter that matched nothing (offer to clear it) vs. a genuinely empty
 * directory (offer to add the first listing).
 */
function BrowseEmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="mt-section flex flex-col items-start gap-3 rounded-card border border-dashed border-border bg-surface p-gutter">
        <h2 className="text-title font-semibold text-foreground">No matching listings</h2>
        <p className="text-body text-muted-foreground">
          No restaurants meet every attribute you selected with positive community consensus yet.
          Try removing a filter to widen your search.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
        >
          Clear filters
        </button>
      </div>
    );
  }

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
