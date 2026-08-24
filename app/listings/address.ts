/**
 * Address parsing for browse surfaces.
 *
 * Client-safe: a pure string helper with no dependencies. Keep it free of
 * db/server-only imports so every browse surface can share one definition.
 */

/**
 * A US "…, City, ST ZIP" tail, anchored to the end of the string. The ZIP is
 * optional so a manually entered "1 Main St, Denver, CO" still resolves, and
 * the non-greedy city capture stops at the last comma before the state code,
 * so a unit or suite segment never leaks into the city.
 */
const CITY_STATE_TAIL = /,\s*([^,]+?)\s*,\s*[A-Za-z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$/;

/**
 * The city from a stored address, or `null` when the address has no US
 * city/state tail. Manual-intake listings carry free-form addresses, so a miss
 * is normal: callers render no city rather than falling back to the full
 * address.
 */
export function cityFromAddress(address: string): string | null {
  const city = CITY_STATE_TAIL.exec(address)?.[1];
  return city ? city.replace(/\s+/g, " ") : null;
}
