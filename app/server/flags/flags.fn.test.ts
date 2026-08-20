import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { flagFnInputSchema } from "./flags.fn";
import { createFlagInputSchema, FLAG_REASON_MAX_LENGTH } from "./index";

/**
 * Drift guard: `flagFnInputSchema` (./flags.fn.ts) ↔ `createFlagInputSchema`
 * (./index.ts) must accept and reject exactly the same payloads (AUB-260).
 *
 * WHY TWO SCHEMAS EXIST — READ BEFORE "FIXING" A FAILURE HERE.
 * The duplication is deliberate and load-bearing, not an oversight:
 * `./index.ts` imports `getDb` (drizzle/neon), and a schema handed to
 * `createServerFn().validator()` runs CLIENT-SIDE — the TanStack Start plugin
 * does not strip it. So importing the schema from `./index.ts` into the
 * client-callable `*.fn.ts` seam would pull the database into the browser
 * bundle, breaking the "no db imports in client code" Hard Rule and the
 * client-bundle guard in ci.yml. That is exactly what the `jscpd:ignore-start`
 * block in `./flags.fn.ts` documents — the duplication detector is
 * deliberately blind there.
 *
 * **Do NOT resolve a failure in this file by merging the two schemas or by
 * importing one from the other.** Fix the drift: make whichever schema fell
 * behind match the other, in place.
 *
 * WHY A RUNTIME TABLE (not a type-level check): the two branches diverge in
 * ways `z.infer` cannot see — a dropped `.trim()`, a loosened `.max()`, a
 * removed `.strict()`, a reworded error message. Both schemas are `z.infer`-
 * identical in every one of those cases, so a type assertion would pass while
 * the server-fn seam and the direct/Hono path silently accept different
 * payloads on a trust-and-safety surface.
 *
 * Each case is parsed by BOTH schemas and we assert:
 *   1. the same accept/reject verdict (and that it matches `expected`, so the
 *      table also pins intended behaviour rather than mere agreement),
 *   2. on success, deep-equal parsed output (catches transform drift, e.g. a
 *      dropped `.trim()` on `reason`),
 *   3. on failure, an identical set of issue `path` + `code` + `message`
 *      (catches refinement and error-copy drift).
 */

// ---------------------------------------------------------------------------
// Shared case table
// ---------------------------------------------------------------------------

type ParityCase = {
  /** Test name; also the failure label. */
  readonly name: string;
  /** Payload fed to both schemas. `unknown` on purpose — invalid rows are the point. */
  readonly input: unknown;
  readonly expected: "accept" | "reject";
};

const MAX = FLAG_REASON_MAX_LENGTH; // 2000
const atMax = "x".repeat(MAX);
const overMax = "x".repeat(MAX + 1);

/**
 * Every constraint the two schemas encode, plus its boundaries:
 *   - `target` discriminator ∈ {"listing","claim","incident"} (exclusive arc)
 *   - the branch's own target id: `z.string().min(1, "<x>Id is required")`
 *   - `reason`: `z.string().trim().min(1).max(FLAG_REASON_MAX_LENGTH)`
 *   - `.strict()` per branch — no extra keys, so a second target id is rejected
 */
const cases: readonly ParityCase[] = [
  // --- Valid: one target per branch ----------------------------------------
  {
    name: "listing branch with a reason",
    input: { target: "listing", listingId: "listing-1", reason: "Spam" },
    expected: "accept",
  },
  {
    name: "claim branch with a reason",
    input: { target: "claim", claimId: "claim-1", reason: "Wrong" },
    expected: "accept",
  },
  {
    name: "incident branch with a reason",
    input: { target: "incident", incidentId: "incident-1", reason: "Inappropriate" },
    expected: "accept",
  },

  // --- Boundaries that must land on the accepting side ----------------------
  {
    name: "single-character target id (min(1) lower edge)",
    input: { target: "listing", listingId: "l", reason: "Spam" },
    expected: "accept",
  },
  {
    name: "single-character reason (min(1) lower edge, post-trim)",
    input: { target: "listing", listingId: "l-1", reason: "x" },
    expected: "accept",
  },
  {
    name: `reason of exactly ${MAX} characters (max upper edge)`,
    input: { target: "listing", listingId: "l-1", reason: atMax },
    expected: "accept",
  },
  {
    name: `reason of ${MAX} characters plus surrounding whitespace (trim runs before max)`,
    input: { target: "listing", listingId: "l-1", reason: `  ${atMax}  ` },
    expected: "accept",
  },
  {
    name: "padded reason (trimmed output is compared, not just the verdict)",
    input: { target: "claim", claimId: "c-1", reason: "  needs review  " },
    expected: "accept",
  },

  // --- Discriminator ---------------------------------------------------------
  { name: "no discriminator at all", input: { reason: "Spam" }, expected: "reject" },
  {
    name: "unknown target value",
    input: { target: "user", userId: "u-1", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "target of the wrong type (number)",
    input: { target: 1, listingId: "l-1", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "target of the wrong type (null)",
    input: { target: null, listingId: "l-1", reason: "Spam" },
    expected: "reject",
  },

  // --- Target id: missing / empty / wrong type -------------------------------
  {
    name: "listing branch missing listingId",
    input: { target: "listing", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "claim branch missing claimId",
    input: { target: "claim", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "incident branch missing incidentId",
    input: { target: "incident", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "empty listingId (min(1))",
    input: { target: "listing", listingId: "", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "empty claimId (min(1))",
    input: { target: "claim", claimId: "", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "empty incidentId (min(1))",
    input: { target: "incident", incidentId: "", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "listingId of the wrong type (number)",
    input: { target: "listing", listingId: 1, reason: "Spam" },
    expected: "reject",
  },
  {
    name: "listingId of the wrong type (null)",
    input: { target: "listing", listingId: null, reason: "Spam" },
    expected: "reject",
  },
  {
    name: "target id belonging to another branch",
    input: { target: "listing", claimId: "c-1", reason: "Spam" },
    expected: "reject",
  },

  // --- Reason ---------------------------------------------------------------
  { name: "missing reason", input: { target: "listing", listingId: "l-1" }, expected: "reject" },
  {
    name: "empty reason",
    input: { target: "listing", listingId: "l-1", reason: "" },
    expected: "reject",
  },
  {
    name: "whitespace-only reason (empty after trim)",
    input: { target: "listing", listingId: "l-1", reason: "   " },
    expected: "reject",
  },
  {
    name: `reason of ${MAX + 1} characters (max upper edge, one over)`,
    input: { target: "listing", listingId: "l-1", reason: overMax },
    expected: "reject",
  },
  {
    name: `reason of ${MAX + 1} characters plus padding (still over after trim)`,
    input: { target: "claim", claimId: "c-1", reason: `  ${overMax}  ` },
    expected: "reject",
  },
  {
    name: "reason of the wrong type (number)",
    input: { target: "listing", listingId: "l-1", reason: 42 },
    expected: "reject",
  },
  {
    name: "reason of the wrong type (null)",
    input: { target: "listing", listingId: "l-1", reason: null },
    expected: "reject",
  },

  // --- Exclusive arc + strictness -------------------------------------------
  {
    name: "two target ids (claim branch also carrying listingId)",
    input: { target: "claim", claimId: "c-1", listingId: "l-1", reason: "Spam" },
    expected: "reject",
  },
  {
    name: "all three target ids",
    input: {
      target: "listing",
      listingId: "l-1",
      claimId: "c-1",
      incidentId: "i-1",
      reason: "Spam",
    },
    expected: "reject",
  },
  {
    name: "unrelated extra key (.strict())",
    input: { target: "listing", listingId: "l-1", reason: "Spam", status: "resolved" },
    expected: "reject",
  },
  {
    name: "reporterId smuggled in (.strict() blocks caller-supplied attribution)",
    input: { target: "listing", listingId: "l-1", reason: "Spam", reporterId: "user-9" },
    expected: "reject",
  },

  // --- Non-object inputs -----------------------------------------------------
  { name: "empty object", input: {}, expected: "reject" },
  { name: "null", input: null, expected: "reject" },
  { name: "undefined", input: undefined, expected: "reject" },
  { name: "a string", input: "listing", expected: "reject" },
  { name: "a number", input: 42, expected: "reject" },
  { name: "an array", input: [], expected: "reject" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A stable, order-independent fingerprint of a rejection: every issue's path,
 * code, and message. Comparing messages (not just paths) is deliberate — it is
 * what catches error-copy drift between the two mirrors.
 */
function fingerprint(error: z.ZodError<unknown>): string[] {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"} | ${issue.code} | ${issue.message}`)
    .sort();
}

describe("flag input schemas stay in sync (AUB-260) — flags.fn.ts ↔ index.ts", () => {
  it("covers both accepting and rejecting cases (the table is not one-sided)", () => {
    // Cheap guard against a future edit gutting the table into a tautology.
    expect(cases.filter((c) => c.expected === "accept").length).toBeGreaterThanOrEqual(3);
    expect(cases.filter((c) => c.expected === "reject").length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const viaFn = flagFnInputSchema.safeParse(testCase.input);
    const viaIndex = createFlagInputSchema.safeParse(testCase.input);

    // 1. Same verdict — and the verdict the table says it should be. If this
    //    fails, ONE of the two mirrors was edited without the other. Fix the
    //    stale schema in place; do not merge them (see the file header).
    expect(viaFn.success).toBe(testCase.expected === "accept");
    expect(viaIndex.success).toBe(viaFn.success);

    if (viaFn.success && viaIndex.success) {
      // 2. Same parsed output — catches transform drift (e.g. a dropped
      //    `.trim()` on one side only).
      expect(viaFn.data).toEqual(viaIndex.data);
      return;
    }

    if (!(viaFn.success || viaIndex.success)) {
      // 3. Same issues — catches refinement and error-message drift.
      expect(fingerprint(viaFn.error)).toEqual(fingerprint(viaIndex.error));
    }
  });
});
