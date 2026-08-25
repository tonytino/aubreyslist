/**
 * The directory's "quick filter" vocabulary + faceted-selection helpers — the
 * prebuilt filters surfaced as chips.
 *
 * URL-driven (`?quick=`, a comma-set like `?attrs=`) and applied server-side:
 * the selection persists across refresh / back-forward / share, and the count
 * + pagination stay honest. The SQL expression of each token lives in
 * `app/server/listings/quick-filter.ts`; the mapping to the displayed glance:
 *   - `celiac` → `safetyState === "celiac-safe"`
 *   - `recent` → `freshness.kind === "fresh"`
 *
 * Faceted selection: tokens belong to groups. Members of an exclusive group
 * are mutually exclusive (pick one or none); other groups are additive, and
 * selections AND-compose across groups. `safety` = {celiac} is exclusive (a
 * degenerate single-member group since AUB-295, kept so a second safety token
 * slots back in without re-deriving the rules); `recency` = {recent} is a
 * standalone additive toggle. A new additive group slots in by adding its
 * tokens + group here and leaving the group out of `EXCLUSIVE_QUICK_GROUPS`.
 *
 * Client-safe + pure: no db/server imports, so the client (schema + chips +
 * route) and the server (the SQL predicate builder) share one definition of
 * the vocabulary and the selection rules.
 */

/** The quick-filter tokens, in chip / canonical order. The single source of the vocabulary. */
export const QUICK_FILTER_VALUES = ["celiac", "recent"] as const;

/** One quick-filter token. */
export type QuickFilterValue = (typeof QUICK_FILTER_VALUES)[number];

/** An active quick-filter selection — a set of tokens (possibly empty), never `null`. */
export type QuickFilterSelection = QuickFilterValue[];

/**
 * The group a quick-filter token belongs to. Tokens in the same exclusive
 * group are mutually exclusive; tokens in different groups AND-compose.
 */
export type QuickFilterGroup = "safety" | "recency";

/** Which group each token belongs to. */
export const QUICK_FILTER_GROUPS: Record<QuickFilterValue, QuickFilterGroup> = {
  celiac: "safety",
  recent: "recency",
};

/**
 * Groups whose members are mutually exclusive (at most one selected at a
 * time). A group not listed here is additive — every member can be on
 * independently. An explicit set (rather than a hard-coded "safety") lets a
 * new additive group slot in without touching the collapse/toggle logic.
 */
export const EXCLUSIVE_QUICK_GROUPS: ReadonlySet<QuickFilterGroup> = new Set<QuickFilterGroup>([
  "safety",
]);

/** True when `value`'s group is mutually exclusive. */
function isExclusive(value: QuickFilterValue): boolean {
  return EXCLUSIVE_QUICK_GROUPS.has(QUICK_FILTER_GROUPS[value]);
}

/**
 * Order a selection by the canonical `QUICK_FILTER_VALUES` order, so a serialized
 * `?quick=` value is stable regardless of the order tokens were toggled in.
 */
function canonicalize(values: readonly QuickFilterValue[]): QuickFilterValue[] {
  const present = new Set(values);
  return QUICK_FILTER_VALUES.filter((token) => present.has(token));
}

/**
 * Parse a raw `?quick=` comma string into a valid, canonical selection: keep
 * only known tokens, de-dupe, then collapse each exclusive group to at most
 * one member — the first in canonical (`QUICK_FILTER_VALUES`) order. Choosing
 * the survivor by vocab order (not URL order) is deterministic and keeps a
 * hand-typed or stale link from resolving to a contradictory selection.
 *
 * Dropping unknown tokens is load-bearing: a shared pre-AUB-295
 * `?quick=friendly` link degrades to no filter rather than erroring.
 */
export function parseQuick(value: string): QuickFilterSelection {
  const valid = new Set<QuickFilterValue>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if ((QUICK_FILTER_VALUES as readonly string[]).includes(token)) {
      valid.add(token as QuickFilterValue);
    }
  }

  const result: QuickFilterValue[] = [];
  const usedExclusiveGroups = new Set<QuickFilterGroup>();
  // Iterate the canonical vocabulary so the surviving exclusive-group member is
  // order-independent (first-in-vocab-order wins).
  for (const token of QUICK_FILTER_VALUES) {
    if (!valid.has(token)) {
      continue;
    }
    const group = QUICK_FILTER_GROUPS[token];
    if (EXCLUSIVE_QUICK_GROUPS.has(group)) {
      if (usedExclusiveGroups.has(group)) {
        continue; // a member of this exclusive group is already selected — drop this one
      }
      usedExclusiveGroups.add(group);
    }
    result.push(token);
  }
  return result;
}

/** Serialize a selection back to the canonical comma-string `?quick=` form. */
export function serializeQuick(values: readonly QuickFilterValue[]): string {
  return canonicalize(values).join(",");
}

/**
 * Toggle `value` in a selection, honoring group rules — the single, unit-testable
 * definition of the chip interaction:
 *  - already selected → remove it (toggle off);
 *  - in an exclusive group → replace any sibling in that group (radio-within-group);
 *  - otherwise → add it (additive toggle).
 * Returns a canonically-ordered selection.
 */
export function applyQuickToggle(
  current: readonly QuickFilterValue[],
  value: QuickFilterValue
): QuickFilterSelection {
  if (current.includes(value)) {
    return canonicalize(current.filter((token) => token !== value));
  }
  const group = QUICK_FILTER_GROUPS[value];
  const kept = isExclusive(value)
    ? current.filter((token) => QUICK_FILTER_GROUPS[token] !== group)
    : [...current];
  return canonicalize([...kept, value]);
}
