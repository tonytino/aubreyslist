import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Ephemeral router `state` (not the URL — url-state.md) carrying a browse
 * card's already-rendered photo — its cached URL and attribution display
 * names — into the listing-detail hero, so the hero can blur-up from that
 * browser-cached image (with credit already attached) instead of showing
 * nothing while the full-res photo loads.
 *
 * Browsers persist `history.state` across a reload, so without consuming it
 * a refresh of the detail page would replay the preview forever. `useListingPreview`
 * consumes it exactly once (see its own doc).
 */
declare module "@tanstack/react-router" {
  interface HistoryState {
    listingPreviewSrc?: string;
    listingPreviewAttributionNames?: string[];
  }
}

export interface ListingPreview {
  src: string;
  attributionNames: string[];
}

/**
 * The `state` prop for a card's `<Link>`. Callers spread this in only when the
 * card has a photo to hand off (`{...(condition ? listingPreviewLinkState(...) : {})}`)
 * so the attribute is omitted, not set to `undefined` — `exactOptionalPropertyTypes`
 * rejects an explicit `undefined` for `Link`'s `state` prop.
 */
export function listingPreviewLinkState(
  photoUrl: string,
  attributionNames: string[]
): {
  state: { listingPreviewSrc: string; listingPreviewAttributionNames?: string[] };
} {
  return {
    state: {
      listingPreviewSrc: photoUrl,
      ...(attributionNames.length > 0 ? { listingPreviewAttributionNames: attributionNames } : {}),
    },
  };
}

/**
 * The preview carried from a card's `<Link>`, or `undefined` on a direct
 * visit/refresh.
 *
 * Read in an EFFECT, never during render: a browser persists `history.state`
 * across a reload, so the router's boot-time location on a REFRESHED detail
 * page still carries a stale `listingPreviewSrc` from the original
 * navigation. Reading it synchronously during render would (a) render the
 * preview on a refresh — the spec requires byte-identical behavior there —
 * and (b) diverge from SSR's `null` on the hydration render, which React
 * reports as a mismatch. Starting at `undefined` and only setting it inside
 * `useEffect` keeps the hydration render's output identical to SSR; the
 * preview then appears one commit later, still well ahead of the network
 * fetch it stands in for.
 *
 * The effect also CONSUMES the state once: `history.replace` rewrites the
 * current entry with the two preview keys stripped, keeping every other key
 * (the router regenerates its own `key`/`__TSR_key`/`__TSR_index` on any
 * `replace` call). A later refresh of this same entry then carries no
 * preview at all.
 */
export function useListingPreview(): ListingPreview | undefined {
  const router = useRouter();
  const [preview, setPreview] = useState<ListingPreview | undefined>(undefined);

  useEffect(() => {
    const { listingPreviewSrc, listingPreviewAttributionNames, ...rest } =
      router.history.location.state;
    if (!listingPreviewSrc) return;
    setPreview({
      src: listingPreviewSrc,
      attributionNames: listingPreviewAttributionNames ?? [],
    });
    router.history.replace(router.history.location.href, rest);
  }, [router]);

  return preview;
}
