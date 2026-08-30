/**
 * The right-edge fade for a horizontally scrolling chip row — the browse card's
 * signals row and the map mini-card's both compose this exact string, so a
 * clipped chip reads as scrollable rather than truncated on either surface.
 *
 * Pair it with `overflow-x-auto` and a hidden scrollbar: the fade is the only
 * remaining cue that there is more to the right, so a row that hides its
 * scrollbar without it silently looks truncated.
 *
 * Single source of the row-fade treatment — do not hand-write the mask on an
 * individual row, or the two surfaces drift.
 */
export const SCROLL_FADE_RIGHT =
  "[mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)]";
