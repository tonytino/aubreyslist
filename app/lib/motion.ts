/**
 * `true` when the visitor asks for reduced motion (client-only; SSR → false).
 *
 * The imperative twin of `motion/react`'s `useReducedMotion` hook: reach for
 * the hook when a component branches on the preference at render time
 * (`ClaimCardDeck`); call this inside effects/handlers that decide a one-off
 * behaviour at the moment it fires (map camera moves, `scrollIntoView`).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
