import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createFlag } from "./index";

/**
 * Client-callable content-flagging server function (issue #39).
 *
 * This `createServerFn` entry point is the ONLY part of the flag server layer
 * that client code (the listing-detail flag controls) imports. Following the
 * established `*.fn.ts` convention (see `attestations.fn.ts`,
 * `incidents.fn.ts`), the db-touching implementation lives in `./index.ts` and
 * the TanStack Start plugin strips this handler body out of the browser bundle —
 * so importing from here never drags `getDb` (neon/drizzle) into the client.
 *
 * The Zod validator is declared HERE as a client-safe schema (declaring it in
 * `./index.ts` would couple the validator to that db-touching module). It
 * enforces the exclusive-arc invariant — exactly one of listing/claim/incident —
 * via a discriminated union, plus a non-empty, length-bounded reason. This
 * `createServerFn().validator(flagFnInputSchema)` boundary IS the authoritative
 * server-side validation (it runs on every call); `createFlagInputSchema` in
 * `./index.ts` mirrors it for direct callers/tests, and the DB
 * `flags_one_target` CHECK is the ultimate guarantee.
 *
 * Server-only at runtime; safe to import from client modules.
 */

/** Max reason length — mirrors `FLAG_REASON_MAX_LENGTH` in `./index.ts`. */
const FLAG_REASON_MAX_LENGTH = 2000;

const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required.")
  .max(FLAG_REASON_MAX_LENGTH, `Reason must be ${FLAG_REASON_MAX_LENGTH} characters or fewer.`);

/**
 * Client-safe mirror of `createFlagInputSchema`: exactly one target (exclusive
 * arc) plus a reason. A discriminated union rejects zero or multiple targets.
 */
const flagFnInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("listing"),
      listingId: z.string().min(1, "listingId is required"),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("claim"),
      claimId: z.string().min(1, "claimId is required"),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("incident"),
      incidentId: z.string().min(1, "incidentId is required"),
      reason: reasonSchema,
    })
    .strict(),
]);

/** Flag-content server function (login-gated, validated). See {@link createFlag}. */
export const submitFlag = createServerFn({ method: "POST" })
  .validator(flagFnInputSchema)
  .handler(({ data }) => createFlag(data));
