import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/button";

/**
 * Visible pagination for the browse list.
 *
 * Renders at the end of the List-view results (after the cards). The server
 * paginates honestly (`getBrowseListings` constrains the count query with the
 * same WHERE as the page query), so "Page N of M" is derived straight from the
 * response's `total`/`pageSize` — never a fabricated count.
 *
 * URL-driven: Previous/Next are real `<Link>`s writing `?page=` with the
 * functional search updater, so every other param (filters, sort, radius,
 * quick, saved) is carried forward, the paged view is
 * shareable/back-forward-correct, and `stripSearchParams` drops `page=1` from
 * the URL at rest. Changing any filter resets `page: 1` at the route.
 *
 * Honest disabled states: at a boundary (page 1 / last page) the control
 * renders as a real `<button disabled>` — not focusable, announced as
 * disabled — never a dead link or a colour-only cue. The whole nav is hidden
 * when there is only one page.
 *
 * List-view only (deliberate): the Map view renders the same server page as
 * pins plus its own bottom mini-card carousel over a viewport-filling canvas —
 * a pager band below it would sit off-screen and fight the carousel. The list
 * is where "page N of M" reading order exists.
 */
export function DirectoryPager({
  page,
  pageSize,
  total,
}: {
  /** The 1-based current page (echoed by the server response). */
  page: number;
  /** The server page size the total is chunked by. */
  pageSize: number;
  /** The honest total under the active filters (same WHERE as the page). */
  total: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) {
    return null;
  }

  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav aria-label="Pagination" className="mt-section flex items-center justify-between gap-3">
      {hasPrev ? (
        <Button variant="outline" asChild>
          <Link to="/" search={(prev) => ({ ...prev, page: page - 1 })}>
            <ChevronLeft aria-hidden="true" />
            Previous
          </Link>
        </Button>
      ) : (
        <Button variant="outline" disabled>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
      )}

      <span className="text-body-sm text-muted-foreground">
        Page {page} of {pageCount}
      </span>

      {hasNext ? (
        <Button variant="outline" asChild>
          <Link to="/" search={(prev) => ({ ...prev, page: page + 1 })}>
            Next
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" disabled>
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </nav>
  );
}
