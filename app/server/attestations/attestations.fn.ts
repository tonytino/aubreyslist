import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  attestationValues as DbAttestationValues,
  claimAttributes as DbClaimAttributes,
} from "~/db/schema";
import { castVote, getClaimAggregate, retractVote } from "./index";

/**
 * Client-callable attestation server functions (wired into the listing-detail
 * voting UI for #32; the DB-touching write/aggregate logic itself is #28).
 *
 * These `createServerFn` entry points are the ONLY part of the attestation
 * server layer that client code (the listing-detail `ClaimVoteControls`)
 * imports. Following the `*.fn.ts` convention (see `incidents.fn.ts`,
 * `current-user.fn.ts`), the db-touching implementations live in `./index.ts`
 * and the TanStack Start plugin strips these handler bodies out of the browser
 * bundle — so importing from here never drags `getDb` (neon/drizzle) into the
 * client build.
 *
 * The Zod validators are declared HERE with a client-safe literal mirror of the
 * `attestation_value` enum (rather than importing the runtime `attestationValues`
 * tuple from `~/db/schema`, which would pull `drizzle-orm/pg-core` into the
 * client). A compile-time assertion keeps the mirror in lockstep with the DB
 * enum — exactly the pattern `app/trust/incident-recency.ts` uses.
 */

/**
 * Client-safe mirror of the `attestation_value` DB enum (`db/schema.ts`). Kept
 * as a plain literal so this module pulls in no schema runtime; the type-level
 * check below fails the build if it ever drifts from `attestationValues`.
 */
const ATTESTATION_VALUES = ["confirm", "dispute"] as const;

// Compile-time guard: the literal mirror and the DB enum must be identical sets.
type _AssertValuesMatch = [
  (typeof DbAttestationValues)[number] extends (typeof ATTESTATION_VALUES)[number] ? true : never,
  (typeof ATTESTATION_VALUES)[number] extends (typeof DbAttestationValues)[number] ? true : never,
];
// Referenced so the unused-type rule keeps the assertion alive.
export type AttestationValuesInSyncWithDb = _AssertValuesMatch;

/**
 * Client-safe mirror of the `claim_attribute` DB enum (the fixed GF taxonomy,
 * `db/schema.ts`). Kept as a plain literal so this module pulls in no schema
 * runtime; the type-level check below fails the build if it ever drifts from
 * `claimAttributes` — same pattern as the attestation-value mirror above.
 */
const CLAIM_ATTRIBUTES = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "cross_contamination_protocol",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "staff_knowledge",
  "gf_substitutes",
] as const;

// Compile-time guard: the literal mirror and the DB enum must be identical sets.
type _AssertAttributesMatch = [
  (typeof DbClaimAttributes)[number] extends (typeof CLAIM_ATTRIBUTES)[number] ? true : never,
  (typeof CLAIM_ATTRIBUTES)[number] extends (typeof DbClaimAttributes)[number] ? true : never,
];
// Referenced so the unused-type rule keeps the assertion alive.
export type ClaimAttributesInSyncWithDb = _AssertAttributesMatch;

/**
 * A `confirm` / `dispute` vote on a `(listing, attribute)` slot (client-safe
 * validator). The claim row is created lazily server-side on the first vote
 * (#150), so no `claimId` is required.
 */
const voteFnInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  attribute: z.enum(CLAIM_ATTRIBUTES),
  value: z.enum(ATTESTATION_VALUES),
});

/** Retracting a vote needs the `(listing, attribute)` slot — the actor is the current user. */
const retractFnInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  attribute: z.enum(CLAIM_ATTRIBUTES),
});

/** Reading a claim's aggregate needs only the claim id. */
const claimAggregateFnInputSchema = z.object({
  claimId: z.string().min(1, "claimId is required"),
});

/** Confirm/dispute server function (login-gated, validated). See {@link castVote}. */
export const submitVote = createServerFn({ method: "POST" })
  .validator(voteFnInputSchema)
  .handler(({ data }) => castVote(data));

/** Retract server function (login-gated, validated). See {@link retractVote}. */
export const removeVote = createServerFn({ method: "POST" })
  .validator(retractFnInputSchema)
  .handler(({ data }) => retractVote(data));

/** Read a claim's aggregate counts + recency. See {@link getClaimAggregate}. */
export const fetchClaimAggregate = createServerFn({ method: "GET" })
  .validator(claimAggregateFnInputSchema)
  .handler(({ data }) => getClaimAggregate(data));
