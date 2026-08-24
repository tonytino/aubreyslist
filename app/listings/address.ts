/**
 * Address parsing for browse surfaces.
 *
 * Client-safe: a pure string helper with no dependencies. Keep it free of
 * db/server-only imports so every browse surface can share one definition.
 */

/**
 * The trailing "ST" / "ST 80205" / "ST 80205-1234" segment, anchored at both
 * ends. Anchored and free of nested quantifiers so it stays linear on any
 * input: `listings.address` is user-controlled on manual intake, so a
 * backtracking pattern here is a plantable render-time stall.
 */
const STATE_TAIL = /^\s*[A-Za-z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$/;

/** Mirrors the manual-intake `address` cap in `~/listings/create-input`. */
const MAX_ADDRESS_LENGTH = 512;

/**
 * The city from a stored address, or `null` when the address has no US
 * city/state tail. Splits on commas rather than matching the whole tail, so
 * cost is linear in the address length.
 *
 * Manual-intake listings carry free-form addresses, so a miss is normal —
 * `null` is the honest answer, and never the street address.
 */
export function cityFromAddress(address: string): string | null {
  // Manual intake caps `address` at 512 (`create-input.ts`), but the Places path
  // and the column itself are uncapped, so bound the work here too: this runs per
  // card and its result reaches an `aria-label`.
  if (address.length > MAX_ADDRESS_LENGTH) return null;
  const segments = address.split(",");
  // "…, City, ST" — the city needs a comma on both sides, so two segments
  // ("Denver, CO") is a miss, not a city.
  if (segments.length < 3) return null;
  if (!STATE_TAIL.test(segments[segments.length - 1] ?? "")) return null;
  const city = (segments[segments.length - 2] ?? "").trim().replace(/\s+/g, " ");
  return city || null;
}
