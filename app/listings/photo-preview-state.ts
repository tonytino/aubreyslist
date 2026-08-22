import { useLocation } from "@tanstack/react-router";

/**
 * Ephemeral router `state` (not the URL — url-state.md) carrying a browse
 * card's already-rendered photo URL into the listing-detail hero, so the
 * hero can blur-up from that browser-cached image instead of showing
 * nothing while the full-res photo loads. Scoped to one client-side
 * navigation: a direct visit or refresh carries no history state at all.
 */
declare module "@tanstack/react-router" {
  interface HistoryState {
    listingPreviewSrc?: string;
  }
}

/**
 * The `state` prop for a card's `<Link>`. Callers spread this in only when the
 * card has a photo to hand off (`{...(condition ? listingPreviewLinkState(url) : {})}`)
 * so the attribute is omitted, not set to `undefined` — `exactOptionalPropertyTypes`
 * rejects an explicit `undefined` for `Link`'s `state` prop.
 */
export function listingPreviewLinkState(photoUrl: string): {
  state: { listingPreviewSrc: string };
} {
  return { state: { listingPreviewSrc: photoUrl } };
}

/** The preview src carried from a card's `<Link>`, or `undefined` on a direct visit/refresh. */
export function useListingPreviewSrc(): string | undefined {
  const location = useLocation();
  return location.state?.listingPreviewSrc;
}
