/**
 * The one sizing + shape spec shared by the entire badge family.
 *
 * Both the headline safety chip ({@link ~/components/SafetySignal}) and the
 * per-claim chip ({@link ~/components/listing/ClaimBadge}) compose this exact
 * string, so every badge renders at the same padding, radius, text size, gap,
 * and icon size everywhere. The headline is distinguished only by its solid
 * colour fill and position, never by size.
 *
 * Single source of badge sizing — do not hand-tune
 * `px-*`/`py-*`/`text-*`/`rounded-*`/icon-size on an individual badge, or the
 * family silently drifts apart.
 *
 * `[&>svg]:size-4` drives the leading glyph on both the raw-`<span>`
 * SafetySignal and the `Badge`-primitive ClaimBadge. On the latter it overrides
 * the primitive's `[&>svg]:size-3` default via tailwind-merge (this string is
 * applied last), so the icon can't fall back to the smaller size.
 */
export const BADGE_FAMILY_SIZE =
  "gap-1.5 rounded-chip px-2.5 py-1 text-body-sm font-medium [&>svg]:size-4";
