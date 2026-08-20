import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createFlag } from "./index";

/**
 * Client-callable content-flagging server function.
 *
 * This `createServerFn` entry point is the only part of the flag server layer
 * that client code imports. Per the `*.fn.ts` convention, the db-touching
 * implementation lives in `./index.ts` and the TanStack Start plugin strips
 * this handler body out of the browser bundle — importing from here never
 * drags `getDb` (neon/drizzle) into the client.
 *
 * The Zod validator is declared here as a client-safe schema (declaring it in
 * `./index.ts` would couple it to that db-touching module). It enforces the
 * exclusive-arc invariant — exactly one of listing/claim/incident — via a
 * discriminated union, plus a non-empty, length-bounded reason. This
 * `createServerFn().validator(flagFnInputSchema)` boundary is the
 * authoritative server-side validation (it runs on every call);
 * `createFlagInputSchema` in `./index.ts` mirrors it for direct
 * callers/tests, and the DB `flags_one_target` CHECK is the ultimate
 * guarantee.
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
/* jscpd:ignore-start -- Accepted clone of `createFlagInputSchema` in
   ./index.ts. The mirror is deliberate and load-bearing: this file is the
   CLIENT-CALLABLE server-fn seam, while ./index.ts imports `db`. Importing the
   schema from there would pull the database into the browser bundle, breaking
   the "no db imports in client code" Hard Rule and the client-bundle guard in
   ci.yml. NOTE: nothing currently asserts the two stay in sync — ./index.test.ts
   exercises `createFlagInputSchema` only. Edit one, edit the other. */
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
/* jscpd:ignore-end */

/** Flag-content server function (login-gated, validated). See {@link createFlag}. */
export const submitFlag = createServerFn({ method: "POST" })
  .validator(flagFnInputSchema)
  .handler(({ data }) => createFlag(data));
