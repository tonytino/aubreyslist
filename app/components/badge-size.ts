/**
 * The ONE sizing + shape spec shared by the entire badge family (AUB-224).
 *
 * Both the headline safety chip ({@link ~/components/SafetySignal}) and the
 * per-claim chip ({@link ~/components/listing/ClaimBadge}) compose this exact
 * string, so every badge — the celiac-safe/gluten-friendly headline AND the
 * other claim badges — renders at the EXACT same padding, radius, text size,
 * gap, and icon size everywhere, including the listing-detail hero. The headline
 * is distinguished ONLY by its SOLID colour fill (and its position), never by
 * size; the other badges keep their soft/outline treatment at the identical
 * size.
 *
 * This is the single source of truth for badge sizing — do NOT hand-tune
 * `px-*`/`py-*`/`text-*`/`rounded-*`/icon-size on an individual badge, or the
 * family will silently drift apart again (the bug AUB-224 fixes).
 *
 * `[&>svg]:size-4` drives the leading glyph from this one string on BOTH the
 * raw-`<span>` SafetySignal and the `Badge`-primitive ClaimBadge — on the
 * latter it also overrides the primitive's own `[&>svg]:size-3` default via
 * tailwind-merge (this string is applied last), so the icon can't fall back to
 * the smaller size.
 */
export const BADGE_FAMILY_SIZE =
  "gap-1.5 rounded-chip px-2.5 py-1 text-body-sm font-medium [&>svg]:size-4";
