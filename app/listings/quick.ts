/**
 * The directory's "quick filter" vocabulary + faceted-selection helpers — the
 * prebuilt filters surfaced as chips (Celiac-safe / Gluten-friendly / Recently
 * verified).
 *
 * URL-driven (`?quick=`, a comma-set like `?attrs=`) and applied SERVER-side
 * (AUB-135/AUB-140): the selection persists across refresh / back-forward / share,
 * and the count + pagination stay honest (the filter constrains the query, not just
 * the loaded page). The SQL EXPRESSION of each token lives in
 * `app/server/listings/quick-filter.ts`; the mapping to the displayed safety glance:
 *   - `celiac`   → `safetyState === "celiac-safe"`   (fresh, uncontested confirm-majority)
 *   - `friendly` → `safetyState === "gluten-friendly"` (contested: disputes tie/lead)
 *   - `recent`   → `freshness.kind === "fresh"`      (a within-window confirmation, no recent incident)
 *
 * FACETED SELECTION (AUB-140): tokens belong to GROUPS. Members of an EXCLUSIVE
 * group are mutually exclusive (pick one or none); other groups are additive and
 * AND-compose across groups. Today: `safety` = {celiac, friendly} is exclusive;
 * `recency` = {recent} is a standalone additive toggle. A future `saved` = {favorited}
 * additive group slots in by adding the token + its group here (and leaving `saved`
 * out of `EXCLUSIVE_QUICK_GROUPS`).
 *
 * CLIENT-SAFE + pure: no db/server imports, so the client (schema + chips + route)
 * and the server (the SQL predicate builder) share this ONE definition of the
 * vocabulary and the selection rules — mirroring the co-located `sort.ts` /
 * `distance.ts` param modules.
 */

/** The quick-filter tokens, in chip / canonical order. The single source of the vocabulary. */
export const QUICK_FILTER_VALUES = ["celiac", "friendly", "recent"] as const;

/** One quick-filter token. */
export type QuickFilterValue = (typeof QUICK_FILTER_VALUES)[number];

/** An active quick-filter selection — a set of tokens (possibly empty), never `null`. */
export type QuickFilterSelection = QuickFilterValue[];

/**
 * The group a quick-filter token belongs to. Tokens in the same EXCLUSIVE group are
 * mutually exclusive; tokens in different groups AND-compose. (`"saved"` is reserved
 * for the future `favorited` toggle and added here when that lands.)
 */
export type QuickFilterGroup = "safety" | "recency";

/** Which group each token belongs to. */
export const QUICK_FILTER_GROUPS: Record<QuickFilterValue, QuickFilterGroup> = {
  celiac: "safety",
  friendly: "safety",
  recent: "recency",
};

/**
 * Groups whose members are mutually exclusive (at most one selected at a time). A
 * group NOT listed here is additive — every member can be on independently. Keeping
 * this as an explicit set (rather than hard-coding "safety") is what lets a future
 * additive group like `saved` slot in without touching the collapse/toggle logic.
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
 * Parse a raw `?quick=` comma string into a valid, canonical selection. Mirrors
 * `parseAttrs`: splits on `,`, keeps only known tokens, de-dupes — THEN collapses
 * each exclusive group to at most one member, keeping the first in canonical
 * (`QUICK_FILTER_VALUES`) order. Because the survivor is chosen by vocab order (not
 * URL order), `?quick=celiac,friendly` and `?quick=friendly,celiac` both resolve to
 * `["celiac"]` — deterministic, and it avoids an always-empty `celiac AND friendly`
 * from a hand-typed or stale link.
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
