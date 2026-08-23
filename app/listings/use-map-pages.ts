import { useCallback, useState } from "react";

/**
 * Accumulated "Load more" pages for the directory Map view.
 *
 * Ephemeral by design (docs/agents/url-state.md): how many extra pages the
 * visitor has appended is progressive-loading progress, like a scroll
 * position — not a view worth sharing. A pasted link or a refresh honestly
 * restarts at the base page, and the list view's `?page=` param keeps its
 * existing contract (one page at a time) untouched.
 *
 * `resultSetKey` is the identity of the result set being accumulated onto —
 * the caller passes the base page's serialized React Query key, so any change
 * that refetches the base page (filters, sort, search text, radius, quick
 * chips, saved mode, coords, an area search, or the base `?page=` itself)
 * resets the accumulation to zero by construction; the two can never drift.
 * The reset is derived during render (no effect), so a key change and the
 * reset land in the same commit.
 */
export function useMapExtraPages(resultSetKey: string): {
  /** How many pages beyond the base page are appended for this result set. */
  extraPages: number;
  /** Append the next page. */
  loadNextPage: () => void;
} {
  const [loaded, setLoaded] = useState({ key: resultSetKey, extra: 0 });
  const extraPages = loaded.key === resultSetKey ? loaded.extra : 0;
  const loadNextPage = useCallback(() => {
    setLoaded((prev) =>
      prev.key === resultSetKey
        ? { key: resultSetKey, extra: prev.extra + 1 }
        : { key: resultSetKey, extra: 1 }
    );
  }, [resultSetKey]);
  return { extraPages, loadNextPage };
}
